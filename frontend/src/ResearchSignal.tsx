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
  [178, 155],
  [198, 147],
  [220, 153],
  [266, 144],
  [285, 148],
  [297, 158],
  [181, 171],
  [199, 162],
  [218, 169],
  [267, 164],
  [282, 158],
  [297, 166],
  [245, 157],
  [238, 191],
  [258, 196],
  [205, 215],
  [228, 224],
  [250, 228],
  [279, 212],
  [269, 238],
  [247, 249],
  [224, 240],
  [163, 196],
  [180, 239],
  [212, 274],
  [253, 288],
  [289, 262],
  [309, 220],
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
  [337, 137],
  [322, 93],
  [306, 62],
  [378, 178],
  [389, 129],
  [401, 83],
  [408, 38],
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
      aria-label="Улыбающийся человек показывает жест Victory; лицо и рука объединены светящимися контрольными точками"
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
          {/* Плечи и поднятое предплечье связывают лицо и жест в один портрет. */}
          <path d="M208 274L200 310L146 331L105 367 M282 274L287 310L328 324L352 350 M200 310L226 331L257 341L287 310" />
          <path d="M350 312L351 349L333 378 M400 314L410 348L418 378" />
          <path
            d="M145 141L178 110L228 120L258 101L295 124L308 158L330 184L309 197L310 222L289 263L253 291L212 277L178 241L154 205L141 178Z"
            fill="#f7fbfa"
          />
          {/* Ломаные пряди, выраженные скулы и подбородок вместо круглого контура. */}
          <path
            d="M146 181L126 158L119 126L132 99L157 73L194 57L239 53L283 68L312 98L321 131L309 158L295 124L258 101L228 120L178 110L149 139Z"
            fill="#e8efeb"
          />
          <path
            d="M130 124L162 93L196 80L230 82 M158 99L191 89L228 96L258 77L290 93 M143 173L132 175L135 194L152 206 M164 217L178 241L213 273"
            strokeOpacity=".5"
          />
          <path d="M177 155L198 146L219 152 M264 144L284 148L297 157 M181 171L198 162L218 169 M267 164L282 158L297 166 M246 158L237 190L258 196" />
          <path
            d="M205 215L228 224L250 228L279 212L269 238L247 249L224 240Z"
            fill="#fff"
          />
          <path
            d="M216 229L240 237L265 230 M198 210L204 205 M281 207L286 211"
            strokeWidth="1.2"
          />
        </g>
        <Landmarks points={face} lines={faceLines} tone="warm" />
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
              d="M355 291L349 265L333 243L322 217L320 195L327 183L333 182L313 110L294 64L296 52L305 48L314 54L329 83L354 150L360 161L371 107L388 57L400 28L411 25L419 31L418 42L407 80L391 135L385 166L392 162L405 166L414 180L424 179L437 188L441 203L436 221L421 246L414 266L417 291"
              fill="#f7fbfa"
            />
            <path d="M327 183L343 176L360 183L379 201L374 215L361 218L343 208 M385 166L399 181L402 202L389 213L378 207 M414 180L425 195L426 208L414 219L403 211 M356 244L375 248L394 239 M357 281L381 286L412 279" />
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
