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

// Стилизованная иллюстрация ориентиров, а не точная карта индексов MediaPipe.
const hand = [
  [417, 328],
  [387, 279],
  [360, 248],
  [336, 218],
  [319, 194],
  [394, 235],
  [384, 180],
  [375, 139],
  [370, 107],
  [423, 224],
  [422, 159],
  [419, 113],
  [417, 76],
  [450, 230],
  [457, 171],
  [461, 132],
  [462, 99],
  [475, 250],
  [492, 210],
  [502, 181],
  [511, 157],
];
const fingers = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
  [5, 9, 13, 17],
];
const face = [
  [130, 145],
  [150, 135],
  [177, 142],
  [198, 137],
  [223, 146],
  [211, 166],
  [194, 168],
  [172, 164],
  [150, 166],
  [133, 162],
  [177, 151],
  [175, 194],
  [162, 204],
  [187, 204],
  [142, 225],
  [160, 240],
  [183, 245],
  [207, 232],
  [219, 214],
  [114, 186],
  [127, 228],
  [147, 263],
  [179, 280],
  [215, 265],
  [240, 232],
  [252, 193],
];
const faceLines = [
  [0, 1, 2],
  [3, 4],
  [0, 9, 8, 7, 2],
  [3, 4, 5, 6, 3],
  [2, 10, 3],
  [10, 11, 12, 13, 11],
  [12, 14, 15, 16, 17, 18, 13],
  [14, 18],
  [19, 0],
  [19, 20, 21, 22, 23, 24, 25, 4],
  [20, 14],
  [18, 24],
  [16, 22],
];

export function ResearchSignal() {
  return (
    <figure
      className="research-signal"
      aria-label="Схематичные лицо и кисть руки с соединёнными контрольными точками"
    >
      <svg viewBox="0 0 600 400" fill="none" aria-hidden="true">
        <defs>
          <radialGradient id="signal-glow">
            <stop stopColor="#c8f5de" />
            <stop offset="1" stopColor="#f7fbfa" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="320" cy="208" rx="290" ry="187" fill="url(#signal-glow)" />
        <g stroke="#c1d9d6" strokeWidth="1">
          <path d="M50 92H75 M50 92V117 M535 92H560V117 M50 305V330H75 M535 330H560V305" />
          <path d="M50 211H560" strokeDasharray="2 8" />
        </g>
        <g
          className="signal-sketch"
          stroke="#426471"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d="M107 171L104 133L119 100L148 83L184 78L218 88L243 109L255 147L257 191L244 234L218 268L181 287L147 272L121 239L106 202L99 180L107 171Z" />
          <path d="M108 148L118 119L147 111L164 95L193 112L225 118L245 145 M107 171L118 176 M250 171L257 162 M143 270L139 312L105 328 M215 269L220 309L254 329" />
          <path d="M127 143L148 135L167 140 M196 137L218 143L229 152 M133 162L147 155L162 164 M192 162L207 158L220 167 M177 159L171 195L184 201 M142 225L160 238L184 243L206 232L219 214" />
          <path d="M395 353L395 324L376 293L354 265L329 235L305 203L310 188L321 186L339 207L369 233L376 237L366 192L355 151L357 113L365 102L375 103L381 115L390 157L401 202L403 204L405 155L404 112L406 76L414 68L424 72L430 86L432 128L434 199L439 205L445 163L450 124L452 101L462 91L471 98L473 114L470 159L464 218L468 226L486 189L499 160L510 148L521 153L521 167L510 199L498 233L487 270L468 306L449 327L447 354" />
          <path
            d="M382 275L402 261L433 259L459 272 M397 319L421 324L444 317"
            strokeOpacity=".55"
          />
        </g>
        <g
          className="landmark-mesh"
          stroke="#087eaa"
          strokeWidth="1.4"
          strokeLinejoin="round"
        >
          {faceLines.map((line, i) => (
            <polyline
              key={i}
              points={line.map((n) => face[n].join(",")).join(" ")}
            />
          ))}
        </g>
        <g
          className="landmark-mesh"
          stroke="#138b70"
          strokeWidth="1.8"
          strokeLinejoin="round"
        >
          {fingers.map((line, i) => (
            <polyline
              key={i}
              points={line.map((n) => hand[n].join(",")).join(" ")}
            />
          ))}
        </g>
        <g className="landmark-points">
          {face.map(([cx, cy], i) => (
            <circle
              key={"f" + i}
              cx={cx}
              cy={cy}
              r="3.2"
              fill="#06a7cb"
              stroke="#f7fbfa"
              strokeWidth="1.2"
            />
          ))}
          {hand.map(([cx, cy], i) => (
            <circle
              key={"h" + i}
              cx={cx}
              cy={cy}
              r="4"
              fill="#58ecac"
              stroke="#137f70"
              strokeWidth="1.2"
            />
          ))}
        </g>
        <path
          className="signal-connection"
          d="M265 195L286 195L297 182L310 182"
          stroke="#089eaa"
          strokeWidth="1.5"
          strokeDasharray="4 5"
        />
        <g
          fill="#3f6471"
          fontSize="12"
          fontFamily="monospace"
          letterSpacing="1.5"
        >
          <text x="118" y="53">
            МИМИКА
          </text>
          <text x="426" y="53">
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
