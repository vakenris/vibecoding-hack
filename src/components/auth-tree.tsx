// A decorative tree drawn in the same restrained palette as the decision paths.
export function AuthTree() {
  return (
    <svg
      className="auth-tree"
      viewBox="0 0 520 620"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <path id="auth-leaf" d="M0 0C-29-10-44-37-38-66C-9-59 8-31 0 0Z" />
      </defs>
      <g
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M267 620C259 536 274 455 262 374C252 306 267 239 258 169C255 137 251 102 261 71" />
        <path d="M264 468C225 433 186 401 159 352C139 316 129 282 111 251" />
        <path d="M261 384C308 350 347 317 368 269C384 234 387 206 402 176" />
        <path d="M260 301C225 270 202 235 187 197C173 163 155 137 134 112" />
        <path d="M260 211C291 185 315 155 322 118C326 94 339 69 355 51" />
        <path d="M192 403C152 400 116 384 87 357M164 361C173 330 166 301 151 274" />
        <path d="M328 330C370 323 411 296 432 267M372 259C351 236 347 208 348 187" />
        <path d="M206 237C172 232 145 216 123 192M179 181C186 157 181 133 171 111" />
        <path d="M309 154C341 150 365 135 382 114M258 130C230 113 215 91 209 67" />
        <path d="M267 582C234 570 215 571 193 578M268 590C292 578 318 575 344 582" />
        <g fill="currentColor" fillOpacity=".22">
          <use href="#auth-leaf" transform="translate(111 251) rotate(-24)" />
          <use href="#auth-leaf" transform="translate(87 357) rotate(-53)" />
          <use href="#auth-leaf" transform="translate(151 274) rotate(15)" />
          <use href="#auth-leaf" transform="translate(123 192) rotate(-48)" />
          <use href="#auth-leaf" transform="translate(134 112) rotate(-18)" />
          <use href="#auth-leaf" transform="translate(171 111) rotate(35)" />
          <use href="#auth-leaf" transform="translate(209 67) rotate(-16)" />
          <use href="#auth-leaf" transform="translate(261 71) rotate(42)" />
          <use href="#auth-leaf" transform="translate(355 51) rotate(83)" />
          <use href="#auth-leaf" transform="translate(382 114) rotate(100)" />
          <use href="#auth-leaf" transform="translate(348 187) rotate(40)" />
          <use href="#auth-leaf" transform="translate(402 176) rotate(82)" />
          <use href="#auth-leaf" transform="translate(432 267) rotate(111)" />
        </g>
      </g>
    </svg>
  );
}
