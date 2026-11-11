//! The gateway client against a stand-in gateway.

use super::*;
use axum::body::Body;
use axum::http::{HeaderMap, StatusCode};
use std::sync::{Arc, Mutex};

type Handler = Arc<dyn Fn(&axum::extract::Request) -> axum::response::Response + Send + Sync>;

/// A gateway to talk to: a local server answering every path with `h`.
async fn test_client(h: Handler) -> Client {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = axum::Router::new().fallback(move |req: axum::extract::Request| {
        let h = h.clone();
        async move { h(&req) }
    });
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Client::new(Config {
        base_url: format!("http://{addr}"),
        app_id: "app-1".into(),
        api_key: "jns_test".into(),
    })
}

fn respond(
    status: u16,
    headers: &[(&str, &str)],
    body: impl Into<Body>,
) -> axum::response::Response {
    let mut b = axum::response::Response::builder().status(status);
    for (k, v) in headers {
        b = b.header(*k, *v);
    }
    b.body(body.into()).unwrap()
}

fn req(slug: &str, path: &str) -> Request {
    Request {
        slug: slug.into(),
        path: path.into(),
        ..Default::default()
    }
}

// The two headers are the whole of the contract, and the third is the one
// JANUS.md asks for by name. What matters as much is what is absent:
// Authorization and Cookie are stripped by the gateway, so sending either is
// sending a secret somewhere it was never needed.
#[tokio::test]
async fn get_sends_the_gateway_headers_and_nothing_else() {
    let seen: Arc<Mutex<Option<(HeaderMap, String, String)>>> = Arc::default();
    let s = seen.clone();
    let c = test_client(Arc::new(move |r| {
        *s.lock().unwrap() = Some((
            r.headers().clone(),
            r.uri().path().to_owned(),
            r.uri().query().unwrap_or("").to_owned(),
        ));
        respond(
            200,
            &[("Content-Type", "application/json")],
            r#"{"ok":true}"#,
        )
    }))
    .await;

    let resp = c
        .get(&Request {
            slug: "twitch-helix".into(),
            path: "/streams".into(),
            query: vec![("game_id".into(), "1372128809".into())],
            limit: 0,
        })
        .await
        .expect("get");

    let (got, path, query) = seen.lock().unwrap().clone().unwrap();
    let h = |n: &str| {
        got.get(n)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned()
    };
    assert_eq!(h("X-Janus-Application-Id"), "app-1");
    assert_eq!(h("X-Janus-Api-Key"), "jns_test");
    assert_eq!(h("X-Janus-Identity"), IDENTITY_APP);
    assert!(
        h("Authorization").is_empty() && h("Cookie").is_empty(),
        "sent an Authorization or Cookie header"
    );
    // The path after the slug is forwarded as is, which is the addressing rule
    // the whole gateway rests on.
    assert_eq!(path, "/gateway/twitch-helix/streams");
    assert_eq!(query, "game_id=1372128809");
    assert_eq!(resp.body, br#"{"ok":true}"#);
}

// The distinction this crate exists to draw. A 404 from the gateway means there
// is no API at that slug; a 404 from the API means it has no such resource.
#[tokio::test]
async fn get_tells_a_gateway_refusal_from_an_upstream_answer_problem_json_is_the_gateway() {
    let c = test_client(Arc::new(|_| {
        respond(
            404,
            &[
                ("Content-Type", "application/problem+json"),
                ("X-Janus-Correlation-Id", "corr-1"),
            ],
            r#"{"code":"provider_unavailable","detail":"Provider is not available"}"#,
        )
    }))
    .await;
    match c.get(&req("nope", "/x")).await {
        Err(Error::Gateway(g)) => {
            assert_eq!(g.code, "provider_unavailable");
            assert_eq!(g.correlation, "corr-1");
        }
        other => panic!("err = {other:?}, want a gateway error"),
    }
}

#[tokio::test]
async fn get_tells_a_gateway_refusal_from_an_upstream_answer_any_other_media_type_is_the_api() {
    let c = test_client(Arc::new(|_| {
        respond(
            404,
            &[("Content-Type", "application/json;charset=utf-8")],
            r#"{"error":"Not Found","status":404}"#,
        )
    }))
    .await;
    match c.get(&req("twitch-helix", "/nope")).await {
        Err(Error::Upstream(u)) => assert_eq!(u.status, 404),
        other => panic!("err = {other:?}, want an upstream error"),
    }
}

// A non-2xx is an error, never an empty result.
#[tokio::test]
async fn get_treats_a_server_error_as_an_error() {
    let c = test_client(Arc::new(|_| {
        respond(502, &[("Content-Type", "application/json")], "")
    }))
    .await;
    assert!(
        c.get(&req("twitch-helix", "/streams")).await.is_err(),
        "a 502 came back as success"
    );
}

// The only pacing signal honoured here.
#[tokio::test]
async fn retry_after_is_carried_on_a_429() {
    let c = test_client(Arc::new(|_| {
        respond(
            429,
            &[
                ("Content-Type", "application/problem+json"),
                ("Retry-After", "42"),
            ],
            r#"{"code":"rate_limited"}"#,
        )
    }))
    .await;
    let err = c.get(&req("twitch-helix", "/streams")).await.unwrap_err();
    assert_eq!(err.retry_after(), Duration::from_secs(42));
}

// What a third party can make this process decode is bounded by the caller.
#[tokio::test]
async fn get_bounds_the_body() {
    let c = test_client(Arc::new(|_| {
        respond(
            200,
            &[("Content-Type", "application/json")],
            "a".repeat(4096),
        )
    }))
    .await;
    let resp = c
        .get(&Request {
            limit: 64,
            ..req("s", "/p")
        })
        .await
        .expect("get");
    assert_eq!(
        resp.body.len(),
        64,
        "read more than the 64 bytes the caller allowed"
    );
}

// Refused here rather than by the gateway.
#[tokio::test]
async fn get_refuses_a_path_the_gateway_would_refuse() {
    let called = Arc::new(Mutex::new(false));
    let k = called.clone();
    let c = test_client(Arc::new(move |_| {
        *k.lock().unwrap() = true;
        respond(StatusCode::OK.as_u16(), &[], "")
    }))
    .await;
    for p in ["/../secret", "//double", "/a%2Fb", "no-leading-slash"] {
        assert!(
            matches!(c.get(&req("s", p)).await, Err(Error::BadPath)),
            "path {p:?} was not refused"
        );
    }
    assert!(
        !*called.lock().unwrap(),
        "a refused path still reached the gateway"
    );
}

// A feature with no key does not half-start.
#[tokio::test]
async fn get_without_configuration_does_not_call() {
    let c = Client::new(Config {
        base_url: "https://example.invalid".into(),
        app_id: "app-1".into(),
        api_key: String::new(),
    });
    assert!(
        !c.config().valid(),
        "a config with no key reported itself valid"
    );
    assert!(matches!(
        c.get(&req("s", "/p")).await,
        Err(Error::NotConfigured)
    ));
}

#[test]
fn retry_after_reads_both_spellings_and_nothing_else() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
    assert_eq!(parse_retry_after("42", now), Duration::from_secs(42));
    assert_eq!(parse_retry_after("0", now), Duration::ZERO);
    assert_eq!(parse_retry_after("-3", now), Duration::ZERO);
    assert_eq!(parse_retry_after("soon", now), Duration::ZERO);
    let later = httpdate::fmt_http_date(now + Duration::from_secs(90));
    assert_eq!(parse_retry_after(&later, now), Duration::from_secs(90));
    let earlier = httpdate::fmt_http_date(now - Duration::from_secs(90));
    assert_eq!(parse_retry_after(&earlier, now), Duration::ZERO);
}

#[test]
fn the_key_is_never_printed() {
    let cfg = Config {
        base_url: "u".into(),
        app_id: "a".into(),
        api_key: "jns_secret".into(),
    };
    assert!(!format!("{cfg:?}").contains("jns_secret"));
}
