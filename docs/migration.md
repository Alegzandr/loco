# Migration LOCO! : serveur en Rust, client en SvelteKit

## Contexte
La migration a deux volets. Le serveur Go (`server/`, 7 paquets, environ 15 000 lignes de code et 20 000 lignes de tests) passe en Rust (Tokio et axum). Le client Astro (`client/`) passe en SvelteKit, en une seule app : on navigue entre les pages de contenu et le jeu sans recharger, et le layout racine garde en vie l'audio et la WebSocket.

Contraintes :
- parité totale avec `docs/protocol.md` et `docs/rules.md` ;
- le serveur reste la seule autorité, et le timing se décide à la réception du message ;
- le drain et le snapshot au SIGTERM sont conservés ;
- pas de base de données, de Redis ni de NATS.

L'ordre de travail est le vôtre (1 à 7). Les 4 sous-agents parallélisent seulement ce qui est indépendant. Tant que l'étape 6 n'est pas verte, le serveur Go reste celui qui tourne.

## Découpage en 4 agents
Chaque agent travaille dans son propre worktree, en TDD : il traduit d'abord le test existant, puis écrit le code. Il met à jour la note de son sous-système dans `docs/notes/`. Je fusionne les branches, j'arbitre les contrats entre agents et je fais la vérification finale.

| Agent | Étapes | Démarre | Dépend de |
| --- | --- | --- | --- |
| **A, Client SvelteKit** | 1 | vague 1 | rien (tourne sur le Go actuel) |
| **B, Domaine Rust** | 2 | vague 1 | rien |
| **C, Protocole** | 3 | vague 1 (crate et générateur), finit après A et B | enums de B ; le TS généré n'entre dans le client qu'après la fusion de A |
| **D, Serveur Rust** | 4 et 5, puis 6 avec moi | vague 1 (socle), handlers après B et C | B et C |

L'étape 7 (CLAUDE.md, README, notes) revient à moi, à partir des notes que chaque agent a mises à jour.

---

## Étape 1, agent A : le client en SvelteKit, sur le serveur Go
- **Structure.** `@sveltejs/kit` avec `adapter-static` : la sortie reste des fichiers statiques derrière nginx, sans Node en production. Les composants Svelte 5, `createStore`, les WAAPI, le Web Audio, Valibot et les polices self-hostées sont gardés tels quels.
- **Routes.** Un `.astro` de `src/pages/` devient une route `+page`. `trailingSlash: 'always'` garde des URL terminées par une barre. Les routes : `/`, `/fr/`, les pages de contenu en deux langues, `/i/` et la 404.
  - Les pages de contenu sont en `prerender = true`.
  - La route du jeu est en `ssr = false` et produit une page fallback.
  - Les URL publiques ne changent pas. `redirects.test.ts` et `seo.test.ts` le vérifient.
- **Layout racine** (`+layout.svelte`). Il porte le header, la typographie, et le moteur audio et le socket en singletons de module. La séquence de `entry.ts` (`initLang` … `initSessionRestore`) passe dans un `onMount` racine, dans le même ordre. `Root.svelte` et `tabLock` (élection avant la première peinture) restent au-dessus de l'app.
- **Ce qu'Astro faisait et qu'il faut remplacer :**
  - le sitemap devient une route `sitemap.xml/+server.ts` prérendue, alimentée par `seo/meta.ts` ;
  - `<Image />` devient `@sveltejs/enhanced-img` ;
  - `inlineStylesheets` devient `kit.inlineStyleThreshold` ;
  - le préfixe `VITE_` reste par défaut avec Vite ;
  - les métadonnées et le JSON-LD passent dans `<svelte:head>`, page par page ;
  - `/i/` garde son titre et son art propres, et reste en `noindex`.
- **CSP.** `kit.csp` en `mode: 'hash'`. nginx envoie la CSP en en-tête, et un en-tête `script-src 'self'` bloquerait le script d'amorçage de SvelteKit. Un script de build extrait donc les hashes des HTML prérendus vers un fichier `client/csp-hashes.conf`, inclus par `security-headers.conf`. Ensuite :
  - `make csp` vérifie la page **servie par nginx**, pas le dev ;
  - `csp.test.ts` est réécrit : il ne cherche plus `client:*`, il vérifie qu'aucun script inline n'a de hash manquant.
- **Tests.**
  - `vitest.config.ts` utilise `sveltekit()` à la place de `getViteConfig`, avec `jsdom` et la condition `browser`.
  - Les tests qui lisent des `.astro` (`contentPages`, `homeLangSwap`, `a11y`, `invitePage`, `seo`, `legal`…) sont repointés vers les `.svelte` et `+page`.
  - `make build-client` devient `svelte-check && vite build`.
- **Règles du CLAUDE.md qui changent**, et c'est assumé :
  - « une page de contenu n'embarque que `page-boot.ts` » et « jamais un island » sont retirées. Une page prérendue charge désormais le runtime de l'app.
  - Elle doit rester **lisible sans JavaScript**. La feuille `<details>` de `/` doit encore s'ouvrir scripts coupés.
  - `/` traduit toujours sur place (`replaceState`) et `data-served-lang` reste.
- **Fini quand :**
  - `make test-client` passe ;
  - la suite Playwright complète passe contre le serveur Go ;
  - `make visual` passe sur `wide`, `small`, `notch` et `landscape`, sans différence acceptée ;
  - `make csp` passe sur la stack Docker ;
  - `docs/notes/client.md` et `seo.md` sont à jour.

## Étape 2, agent B : la crate domaine `loco-game`
- **Pure** : pas d'async, pas d'I/O, pas d'horloge, pas d'`OsRng`.
  - Signature : `Room::apply(&self, action: Action, now: Millis) -> Result<(Room, Vec<Event>), GameError>`. On passe d'état en état, et le temps est une donnée de l'action.
  - Le RNG est un `rand_chacha::ChaCha12Rng` à seed explicite, stocké dans l'état. Le hub le seede depuis `OsRng`, donc la donne reste cachée.
  - Les bots reçoivent leur RNG en paramètre.
- **wasm32.** Une étape CI lance `cargo build -p loco-game --target wasm32-unknown-unknown`. Les listes de mots sont chargées par `include_str!`.
- **Tests.** Les 276 tests de `server/game/` sont reproduits un à un, sous le même nom. `rng_test` (l'attaque par graine d'horloge) est réécrit contre ChaCha. S'y ajoutent :
  - `proptest` sur les invariants : 112 cartes conservées, `Wild` jamais en `ActiveColor`, une pioche ne rate jamais, `requireLocoToFinish` sur les quatre chemins de victoire ;
  - `insta` sur les événements d'un scénario complet.
- **Contrat** : les champs serde de `Room` gardent les noms JSON du Go. Le snapshot en dépend.
- **Fini quand** : la parité test par test est atteinte, `proptest` passe et `docs/notes/domain-rules.md` est à jour.

## Étape 3, agent C : la crate `loco-protocol` et la génération
- `ClientMsg` et `ServerMsg` deviennent des enums `#[serde(tag = "type")]`. Le JSON sur le fil reste identique : plat, `type` plus les champs.
- **Règle à préserver** : « un zéro est une valeur ». Ce qui est un pointeur en Go devient `Option<T>` avec `skip_serializing_if`, et rien d'autre ne saute. `interrupt_open` est un `Option<bool>`, où absent veut dire inchangé.
- **TypeScript** : `ts-rs` génère `protocol.ts`. Le type devient une union discriminée par `type`. Les accès du client sur l'enveloppe (`serverMessages.ts`, les tests) sont resserrés par `switch` sur `type`, sans changer le comportement.
- **Valibot** : `schemars` sort un JSON Schema, et un convertisseur dans le dépôt (`tools/protocol/valibot.mjs`) écrit `protocolSchemas.ts`. Comme le générateur Go, il **refuse** toute construction qu'il ne sait pas écrire honnêtement.
- `make protocol` génère les fichiers et `make protocol-check` (job CI `protocol_check`) échoue s'ils dérivent.
- Les tests client qui lisent du `.go` sont repointés vers les constantes `.rs` équivalentes : `serverMirrors`, `contentPages`, `maps`, `seatLayout`, `seo`, `legal` (la règle `RemoteAddr` devient `remote_addr` hors `privacy.rs`).
- **Garde de parité** : une fixture de messages réels capturés sur le serveur Go pendant l'E2E est relue par le Rust. Chaque message est désérialisé puis resérialisé, et doit ressortir égal au JSON d'origine.
- **Fini quand** : la parité des fixtures est atteinte, le check de dérive passe, les tests client passent et `docs/protocol.md` est à jour.

## Étapes 4 et 5, agent D : hub, tables, WebSocket, drain et snapshot
- **Disposition** : un workspace dans `server-rs/` (renommé `server/` à la bascule). Crates `loco-game`, `loco-protocol`, `loco-janus`, `loco-twitch`, `loco-hub` et `loco-server` (binaire), avec un module par fichier Go actuel pour garder les notes navigables.
- **axum** sert `/ws`, `/health`, `/metrics`, `/live.json` et `/live-thumb/`. Avant l'upgrade, il contrôle `Origin`, `MaxClients` et `MaxConnsPerNet`, puis `clientNet` (en-têtes de confiance et `TrustedProxies`).
- **Une tâche Tokio par table**, alimentée par un `mpsc(64)`, qui possède seule son état, sans verrou. Les délais (bots, LOCO!, catch, tour, reconnexion, map gate, salle vide) passent par un `select!` sur `sleep_until(prochaine échéance)`, à la place de `AfterFunc`. Les échéances vivent dans l'état de la table, ce qui élimine les rappels périmés au lieu de les filtrer.
- **Hub** : une boucle `select!`. Les envois hub → table et table → hub restent non bloquants (`try_send`), avec un retry unique, un `WARN` et un compteur de pertes. `catch_unwind` est placé autour de chaque job, et `handler_panics` reste exposé.
- **Client WebSocket** : un `mpsc(256)` d'envoi, fermé de force s'il est plein. Le token bucket reste à 10/s en rafale de 20, avec une lecture limitée à 4096 octets et le ping/RTT toutes les 5 s.
- **Observabilité** :
  - `tracing` avec une sortie `key=value`, `conn=` sur chaque ligne et un writer non bloquant borné ;
  - `log_lines_dropped` est conservé ;
  - les adresses sont tronquées en /24 et /48 avant écriture.
- **Métriques** : `metrics` avec un export Prometheus sur `/metrics`. Les helpers E2E qui lisent `matchmaking_queue` (`matchmakingQueue.ts`, `play-bot.spec.ts`) passent au format texte. `/health` reste en JSON.
- **Drain et snapshot** :
  - même comportement au SIGTERM, avec `LOCO_DRAIN_TIMEOUT` ;
  - `SnapshotSchemaVersion` reste à 5 et la forme JSON ne change pas ;
  - avant la bascule, je produis une fixture avec le serveur Go, et un test Rust la charge et reprend la partie.
- **Le reste à porter** : Janus (`reqwest` et rustls), le poller Twitch et `main`.
- **Tests** : les 301 tests du hub sont portés. Le harnais WebSocket passe en `tokio-tungstenite`, et `tokio::time::pause` remplace les `sleep`. `criterion` sert pour `bench-server`, à comparer aux 8,6 µs.
- **Qualité** : `clippy -D warnings`, `rustfmt --check`, `cargo-deny` (licences et avis), et `#![forbid(unsafe_code)]`.
- **Image** : un binaire statique musl sur `gcr.io/distroless/static:nonroot` (uid 65532, donc `docs/deployment.md` est mis à jour). Distroless n'a pas de `wget`, donc le healthcheck passe par `loco-server healthcheck`. `read_only`, `cap_drop: ALL` et `/data` restent.
- **Exploitation** : Makefile, `docker-compose.dev.yml` (`cargo watch`) et `.gitlab-ci.yml` (`backend_test`, `backend_lint`, `protocol_check`, cache `server-bin`, `e2e_test` sans Go). Tout ça est prêt mais n'est activé qu'à la bascule.

## Étape 6 (D et moi) : l'E2E sur le serveur Rust
La suite Playwright tourne contre `LOCO_E2E=1 LOCO_BOT_THINK_MS=250 LOCO_BOT_JITTER_MS=200 loco-server`. Chaque échec est renvoyé à l'agent responsable. Une fois tout vert :
- je supprime le Go et renomme `server-rs/` en `server/` ;
- j'active le CI Rust ;
- je fais un dernier passage de `make visual`.

## Étape 7 (moi) : la documentation
- **CLAUDE.md**
  - L'index du dépôt passe aux chemins `.rs` et SvelteKit.
  - La règle `-race` est remplacée par « la table possède son état, rien d'autre ne le lit ».
  - La règle d'état partagé et les règles client retirées à l'étape 1 sont mises à jour.
  - Les commandes sont actualisées.
- **README.md** et **`docs/features.md`** sont mis à jour là où ils sont touchés.
- **`docPaths.test.ts`** doit passer, puisqu'il vérifie que chaque chemin cité existe.

## Vérification
1. `cargo test --workspace`, `clippy`, `fmt`, `deny` et la build wasm32 de `loco-game` passent dans Docker. Il n'y a pas de `make` sur l'hôte : les commandes passent par Docker ou PowerShell.
2. `make protocol-check` ne trouve aucune différence, et la parité des fixtures Go/Rust tient.
3. `make test-client` passe, puis `make build-client` (`svelte-check` et `vite build`).
4. La suite E2E complète passe deux fois : sur le Go après l'étape 1, et sur le Rust à l'étape 6.
5. `make visual` passe, sans différence sur les scènes existantes.
6. Stack de prod en local : distroless, `read_only`, `/health`, puis `make csp` sur la page servie et `redirects.test.ts`.
7. SIGTERM en pleine partie, redémarrage, puis reconnexion qui retrouve le siège. Le même test passe avec une fixture de snapshot produite par Go.
8. Le benchmark et la RAM sont relevés pour le Go et le Rust, et rapportés tels quels.
