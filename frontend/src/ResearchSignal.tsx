// Волна сохранена как альтернативная композиция.
export function WaveSignal() {
  return (
    <div className="signal">
      <svg viewBox="0 0 600 360" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="sea">
            <stop stopColor="#1662ef" />
            <stop offset=".5" stopColor="#00b7ce" />
            <stop offset="1" stopColor="#6cffa7" />
          </linearGradient>
        </defs>
        <g className="waves">
          {Array.from({ length: 22 }, (_, i) => (
            <path
              key={i}
              d={`M -50 ${100 + i * 6} C 90 ${-120 + i * 14}, 200 ${490 - i * 11}, 320 ${200 + i * 3} S 480 ${-40 + i * 13}, 650 ${140 + i * 6}`}
              stroke="url(#sea)"
              strokeWidth={i % 5 === 0 ? 2 : 1}
              opacity={0.35 + i / 40}
            />
          ))}
        </g>
        <circle cx="315" cy="180" r="67" stroke="#ffffff" strokeWidth=".7" />
        <circle cx="315" cy="180" r="4" fill="#123d5b" />
        <path
          d="M 315 100 V 120 M 315 240 V 260 M 235 180 H 255 M 375 180 H 395"
          stroke="#123d5b"
          strokeWidth="1"
        />
      </svg>
      <div className="signal-caption">
        <span>ЧЕЛОВЕК → СИГНАЛ → ПОНИМАНИЕ</span>
      </div>
    </div>
  );
}

// Авторская схема ориентиров, не точная карта индексов MediaPipe.
const face = [
  [178, 154],
  [198, 151],
  [220, 159],
  [265, 157],
  [284, 148],
  [299, 148],
  [181, 171],
  [195, 166],
  [215, 171],
  [267, 170],
  [282, 161],
  [297, 161],
  [245, 158],
  [239, 196],
  [258, 201],
  [211, 230],
  [231, 226],
  [247, 231],
  [277, 222],
  [266, 238],
  [245, 242],
  [227, 239],
  [163, 202],
  [182, 256],
  [223, 284],
  [270, 284],
  [299, 263],
  [310, 218],
];
const faceLines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [9, 10, 11],
  [2, 12, 3],
  [12, 13, 14],
  [13, 15],
  [14, 18],
  [15, 16, 17, 18],
  [15, 21, 20, 19, 18],
  [22, 6],
  [22, 23, 24, 25, 26, 27, 11],
  [23, 15],
  [18, 27],
  [20, 25],
];
const hand = [
  [383, 271],
  [349, 237],
  [338, 217],
  [347, 198],
  [371, 208],
  [353, 186],
  [340.3, 149.04],
  [326.8, 117.36],
  [312.4, 95.04],
  [377.2, 178.56],
  [387.1, 143.28],
  [397.9, 110.16],
  [404.2, 77.76],
  [392, 183],
  [405, 187],
  [403, 207],
  [388, 216],
  [412, 199],
  [428, 202],
  [421, 222],
  [409, 226],
];
const handLines = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
  [5, 9, 13, 17],
];

function Landmarks({
  points,
  lines,
  tone,
}: {
  points: number[][];
  lines: number[][];
  tone: "warm" | "lime";
}) {
  return (
    <g
      className={`landmarks landmarks-${tone}`}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g className="landmark-mesh">
        {lines.map((line, i) => (
          <polyline
            key={i}
            points={line.map((n) => points[n].join(",")).join(" ")}
          />
        ))}
      </g>
      <g className="signal-flow" aria-hidden="true">
        {lines.map((line, i) => (
          <polyline
            key={i}
            pathLength="100"
            points={line.map((n) => points[n].join(",")).join(" ")}
          />
        ))}
      </g>
      <g className="landmark-points">
        {points.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="3.2" />
        ))}
      </g>
    </g>
  );
}

export function ResearchSignal() {
  return (
    <figure
      className="research-signal"
      aria-label="Угловатый мужской портрет с уверенным взглядом и лёгкой улыбкой показывает жест Victory; лицо и рука объединены светящимися контрольными точками"
    >
      <svg viewBox="0 0 600 420" fill="none" aria-hidden="true">
        <defs>
          <radialGradient id="signal-glow">
            <stop stopColor="#e5f3c4" />
            <stop offset=".6" stopColor="#dff4ec" stopOpacity=".65" />
            <stop offset="1" stopColor="#f7fbfa" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="283" cy="211" rx="248" ry="197" fill="url(#signal-glow)" />
        <g stroke="#bfd6cf" strokeWidth="1">
          <path d="M86 95V70H111 M450 70H475V95 M86 347V372H111 M450 372H475V347" />
          <path d="M70 211H486" strokeDasharray="2 9" />
          <ellipse
            cx="283"
            cy="214"
            rx="192"
            ry="153"
            strokeDasharray="3 10"
            transform="rotate(-18 283 214)"
          />
        </g>
        <g
          className="signal-sketch"
          stroke="#36525c"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {/* Выраженная челюсть, короткая стрижка и широкая линия плеч. */}
          <path d="M203 270L198 309L144 328L95 369 M291 267L298 310L330 326L352 350 M198 309L225 332L260 341L298 310" />
          <path d="M350 312L351 349L333 378 M400 314L410 348L418 378" />
          <path
            d="M147 134L172 102L222 91L268 96L298 119L308 155L328 184L310 195L313 226L301 266L272 287L223 287L182 260L158 212L141 180Z"
            fill="#f7fbfa"
          />
          <path
            d="M145 175L132 150L131 119L148 91L180 72L226 65L270 75L298 93L311 122L308 153L292 126L274 114L247 111L221 103L184 111L159 135L154 164Z"
            fill="#d7e2dd"
          />
          <path
            d="M148 112L177 91L222 82L264 90 M145 135L153 121 M146 147L155 133 M148 159L157 145"
            strokeOpacity=".55"
          />
          <path d="M145 175L133 171L133 191L153 209 M142 181L144 192 M163 202L184 199L204 210 M283 198L307 208 M245 158L239 196L258 201" />
          <path
            d="M183 251L221 267L245 262L272 255L308 229L299 265L271 285L223 285L182 258Z"
            fill="#e6ede8"
            stroke="none"
          />
          <path
            d="M211 230L231 226L247 231L277 222L266 238L245 242L227 239Z"
            fill="#fff"
          />
          <path
            d="M219 232L245 236L270 228 M205 223L211 219 M278 218L284 213 M231 259L258 259 M208 263L212 269 M218 268L221 274 M278 262L275 268"
            strokeWidth="1.2"
          />
        </g>
        <Landmarks points={face} lines={faceLines} tone="warm" />
        {/* Глаза поверх сетки: тёмные веки и зрачки остаются читаемыми при свечении. */}
        <g stroke="#29434d" strokeLinejoin="miter" strokeLinecap="round">
          <path
            d="M176 153L196 147L222 157L222 163L197 155L178 160Z M263 156L284 143L301 144L300 151L284 151L263 162Z"
            fill="#29434d"
            stroke="none"
          />
          <path
            d="M181 171L195 166L215 171L207 177L191 179Z M267 170L282 161L297 161L290 169L277 175Z"
            fill="#fff"
            strokeWidth="1.5"
          />
          <path
            d="M181 171L195 166L215 171 M267 170L282 161L297 161"
            strokeWidth="2.7"
          />
          <circle cx="201" cy="172" r="3.6" fill="#29434d" stroke="none" />
          <circle cx="283" cy="166" r="3.4" fill="#29434d" stroke="none" />
          <circle cx="202" cy="171" r="1" fill="#fff" stroke="none" />
          <circle cx="284" cy="165" r="1" fill="#fff" stroke="none" />
        </g>
        {/* Кисть меньше головы, перекрывает её край и продолжает линию предплечья. */}
        <g transform="translate(58 80) scale(.82)">
          <g
            className="signal-sketch"
            stroke="#36525c"
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <path
              d="M355 291L349 265L333 243L322 217L320 195L327 183L333 182L318.7 129.6L301.6 96.48L303.4 87.84L311.5 84.96L319.6 89.28L333.1 110.16L355.6 158.4L361 166.32L370.9 127.44L386.2 91.44L397 70.56L406.9 68.4L414.1 72.72L413.2 80.64L403.3 108L388.9 147.6L383.5 169.92L389.8 167.04L401.5 169.92L414 180L418.6 179.28L437 188L441 203L436 221L421 246L414 266L417 291"
              fill="#f7fbfa"
            />
            <path d="M327 183L345.7 177.12L360 183L379 201L374 215L361 218L343 208 M383.5 169.92L399 181L402 202L389 213L378 207 M414 180L425 195L426 208L414 219L403 211 M356 244L375 248L394 239 M357 281L381 286L412 279" />
          </g>
          <Landmarks points={hand} lines={handLines} tone="lime" />
        </g>
        <g stroke="#bd702e" strokeWidth="1" strokeOpacity=".65">
          <path d="M151 214L107 242H64 M407 169L449 146H512" />
        </g>
        <g
          fill="#476470"
          fontSize="11"
          fontFamily="monospace"
          letterSpacing="1.2"
        >
          <text x="52" y="262">
            МИМИКА
          </text>
          <text x="453" y="136">
            ЖЕСТЫ
          </text>
        </g>
      </svg>
      <figcaption>
        Разные сигналы <span aria-hidden="true">·</span> общее понимание
      </figcaption>
    </figure>
  );
}
