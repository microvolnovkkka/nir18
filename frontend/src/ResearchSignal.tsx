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
  [194, 170],
  [209, 172],
  [228, 181],
  [250, 181],
  [265, 172],
  [280, 167],
  [240, 181],
  [236, 204],
  [248, 208],
  [221, 235],
  [242, 238],
  [264, 231],
  [168, 194],
  [183, 238],
  [212, 271],
  [243, 296],
  [274, 270],
  [294, 234],
  [308, 190],
  [211, 214],
  [277, 210],
];
const faceLines = [
  [0, 1, 2],
  [3, 4, 5],
  [2, 6, 3],
  [6, 7, 8],
  [7, 9, 10, 11, 8],
  [12, 19, 9],
  [11, 20, 18],
  [12, 13, 14, 15, 16, 17, 18],
  [9, 13],
  [11, 17],
  [10, 15],
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
      aria-label="Абстрактный портрет с заострённым подбородком и узким прищуром показывает жест Victory; лицо и рука объединены светящимися контрольными точками"
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
          {/* Один сужающийся контур, минимум внутренних линий. */}
          <path d="M211 272L206 310L149 331L105 369 M278 267L283 310L329 326L352 350 M206 310L229 331L254 338L283 310" />
          <path d="M350 312L351 349L333 378 M400 314L410 348L418 378" />
          <path
            d="M165 154L167 117L186 92L220 79L262 83L292 102L307 132L309 177L295 234L275 269L243 299L212 273L183 238L168 198Z"
            fill="#f7fbfa"
          />
          <path
            d="M166 151L181 128L209 115L247 119L276 111L299 135"
            strokeWidth="1.4"
          />
          <path
            d="M240 181L236 204L248 208 M221 235L242 238L264 231"
            strokeWidth="1.5"
          />
        </g>
        <Landmarks points={face} lines={faceLines} tone="warm" />
        {/* Близко посаженные узкие глаза: верхнее веко, короткая нижняя грань и точка. */}
        <g stroke="#29434d" strokeLinejoin="miter" strokeLinecap="round">
          <path
            d="M194 170L209 172L228 181 M250 181L265 172L280 167"
            strokeWidth="2.3"
          />
          <path
            d="M198 176L212 181L224 181 M254 182L266 179L277 173"
            strokeWidth="1"
          />
          <circle cx="215" cy="177.5" r="2.2" fill="#29434d" stroke="none" />
          <circle cx="261" cy="177" r="2.2" fill="#29434d" stroke="none" />
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
