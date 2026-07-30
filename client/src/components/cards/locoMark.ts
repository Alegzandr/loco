// The LOCO mark: a geometric wireframe duck, straight from the brand's own
// source file (`logo_canard_geometrique.svg`). Even-odd fill: the facets between
// the bars are holes in the outer silhouette, which is what makes it read as a
// wire drawing rather than a solid animal.
//
// This is the designer's geometry, unmodified — do not redraw, retrace or
// "clean up" the numbers. Everything the brand shows derives from this one path:
// the watermark on every card face, the deck back, the felt, the logo and the
// favicon. Change it here and all five follow.
//
// It is landscape (712x576) and complete in itself. Consumers must therefore
// preserve its aspect ratio; the mark box is not the card box.
export const LOCO_MARK_VIEWBOX = '0 0 712 576'
export const LOCO_MARK_W = 712
export const LOCO_MARK_H = 576

export const LOCO_MARK_PATH =
  'M 141 47 L 84 106 L 83 108 L 84 121 L 79 126 L 24 167 L 20 171 L 20 176 L 24 180 L 113 180 L 114 179 L 155 179 L 156 180 L 106 313 L 84 423 L 106 445 L 182 512 L 191 515 L 371 541 L 378 543 L 457 554 L 476 555 L 598 480 L 691 386 L 691 382 L 689 378 L 683 374 L 652 362 L 610 343 L 472 286 L 465 282 L 448 276 L 397 271 L 310 265 L 300 263 L 299 262 L 325 189 L 331 129 L 333 121 L 335 91 L 261 20 L 253 20 Z M 575 465 L 574 467 L 517 498 L 475 523 L 445 518 L 509 463 L 572 464 L 573 465 L 574 464 Z M 487 409 L 489 408 L 519 440 L 507 446 Z M 650 406 L 596 452 L 548 446 L 550 444 L 635 411 L 642 407 L 648 405 Z M 121 421 L 164 401 L 216 466 L 221 474 L 220 475 L 206 471 L 183 468 L 171 464 L 123 424 Z M 153 385 L 154 383 L 156 384 L 154 386 Z M 452 344 L 455 343 L 609 393 L 620 395 L 544 339 L 546 338 L 571 348 L 654 377 L 664 382 L 644 391 L 527 437 Z M 186 388 L 282 290 L 430 338 L 495 451 L 403 515 L 402 513 L 417 452 L 431 386 L 415 417 L 376 508 L 273 484 L 259 470 Z M 328 282 L 330 281 L 347 284 L 357 284 L 434 292 L 491 326 L 521 346 L 519 347 L 513 344 L 429 316 L 426 316 L 423 314 L 420 314 L 417 312 L 336 285 L 329 284 Z M 283 234 L 284 237 L 270 275 L 208 336 L 156 384 L 155 382 L 179 355 L 187 344 Z M 185 181 L 186 182 L 185 186 L 162 229 L 161 226 L 178 183 L 180 181 Z M 301 181 L 302 183 L 233 257 L 147 356 L 120 385 L 119 384 L 125 366 L 142 296 L 239 240 L 168 263 L 165 262 L 211 180 L 213 178 L 227 178 L 228 179 L 251 179 L 252 180 L 295 181 L 296 182 Z M 121 155 L 120 157 L 69 162 L 53 165 L 51 164 L 103 125 Z M 263 46 L 313 99 L 305 170 L 303 175 L 276 94 L 276 91 L 274 88 L 266 60 L 264 57 L 262 50 Z M 241 41 L 244 46 L 248 63 L 266 123 L 272 139 L 278 162 L 276 163 L 246 159 L 199 156 L 151 151 L 123 99 L 127 93 L 156 62 L 225 45 L 229 45 Z'

// Weight is a *rendering* parameter, not a second path: stroking the mark with
// its own paint thickens every bar and closes the facets by exactly the amount
// asked for. A dilated copy would be a second geometry to keep in sync with the
// designer's, and it would drift.
//
// Stroke widths are in the mark's own user units (712x576).
/** Beside 700-weight display type the card-weight bars read as a wire drawing. */
export const LOCO_MARK_BOLD_STROKE = 14
/** A tab icon is 16px: below this weight the facets fill in and it turns to mush. */
export const LOCO_MARK_ICON_STROKE = 28
