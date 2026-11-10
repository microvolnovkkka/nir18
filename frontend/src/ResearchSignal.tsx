import { useEffect, useRef, type CSSProperties } from "react";

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

// Узлы левой половины и оси симметрии размечены по референсу.
const faceHalf = [
  [673, 133],
  [626, 140],
  [595, 165],
  [614, 198],
  [643, 193],
  [594, 216],
  [618, 207],
  [656, 208],
  [653, 217],
  [609, 235],
  [629, 225],
  [650, 237],
  [629, 251],
  [580, 241],
  [593, 271],
  [587, 299],
  [618, 314],
  [649, 290],
  [665, 234],
  [665, 286],
  [660, 296],
  [674, 299],
  [669, 317],
  [640, 329],
  [661, 328],
  [674, 332],
  [660, 345],
  [638, 349],
  [595, 326],
  [614, 355],
  [651, 382],
  [674, 389],
  [674, 357],
];
const halfLines = [
  [0, 1, 2, 13, 15, 28, 29, 30, 31],
  [0, 4, 1, 3, 2],
  [4, 3, 5, 13, 9, 5],
  [3, 6, 7, 4],
  [6, 8, 7],
  [5, 6, 10, 9, 12, 11, 10],
  [8, 10],
  [8, 11, 18, 8],
  [13, 14, 9],
  [12, 14, 15, 16, 14, 17, 12],
  [18, 17, 19, 18],
  [17, 20, 19],
  [20, 21, 22, 20],
  [16, 17, 23, 16, 27, 23, 22],
  [23, 24, 25],
  [23, 26, 27, 32, 26],
  [28, 16, 29, 27, 30, 32],
  [32, 31],
];
const face = [...faceHalf];
const mirror = faceHalf.map(([x, y], i) => {
  if (x >= 673) return i;
  return face.push([1348 - x, y]) - 1;
});
const faceLines = [
  ...halfLines,
  ...halfLines.map((line) => line.map((i) => mirror[i])),
  ...[4, 7, 18, 19, 22, 26].map((i) => [i, mirror[i]]),
];

// Запястье и пять цепочек пальцев раскрытой ладони.
const hand = [
  [913, 408],
  [893, 393],
  [870, 373],
  [843, 336],
  [831, 303],
  [824, 282],
  [883, 361],
  [871, 284],
  [864, 243],
  [860, 215],
  [858, 198],
  [893, 359],
  [896, 282],
  [898, 236],
  [901, 203],
  [902, 185],
  [902, 361],
  [918, 291],
  [924, 250],
  [929, 220],
  [931, 201],
  [912, 364],
  [937, 305],
  [947, 276],
  [954, 257],
  [959, 241],
  [919, 382],
  [930, 515],
];
const handLines = [
  [27, 0, 1, 2, 3, 4, 5],
  [2, 6, 7, 8, 9, 10],
  [6, 11, 12, 13, 14, 15],
  [11, 16, 17, 18, 19, 20],
  [16, 21, 22, 23, 24, 25],
  [21, 26, 0],
  [7, 12, 17, 22],
];

function Landmarks({
  points,
  lines,
  tone,
}: {
  points: number[][];
  lines: number[][];
  tone: "face" | "hand";
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
            pathLength="100"
            style={{ "--order": i } as CSSProperties}
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
      <g className="landmark-points" fill={`url(#mesh-${tone})`}>
        {points.map(([cx, cy], i) => (
          <circle
            key={i}
            style={{ "--order": i } as CSSProperties}
            cx={cx}
            cy={cy}
            r={tone === "face" ? 2.9 : 4.1}
          />
        ))}
      </g>
    </g>
  );
}

export function ResearchSignal() {
  const figure = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = figure.current;
    if (!element) return;
    let inView = true;
    const sync = () => {
      element.dataset.running = String(inView && !document.hidden);
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return (
    <figure
      className="research-signal"
      ref={figure}
      aria-label="Силуэт человека с поднятой раскрытой ладонью. Цветная сетка показывает ориентиры мимики и жестов."
    >
      <svg viewBox="405 35 602 510" fill="none" aria-hidden="true">
        <defs>
          <linearGradient
            id="skin"
            x2="0"
            y2="1"
            gradientUnits="objectBoundingBox"
          >
            <stop stopColor="#e2eff3" />
            <stop offset="1" stopColor="#f7fbfa" />
          </linearGradient>
          {(["face", "hand"] as const).map((tone) => (
            <linearGradient
              key={tone}
              id={`mesh-${tone}`}
              gradientUnits="userSpaceOnUse"
              x1={tone === "face" ? 580 : 824}
              x2={tone === "face" ? 768 : 959}
              y1="0"
              y2="0"
            >
              <stop stopColor="#197cbb" />
              <stop offset=".55" stopColor="#0da9af" />
              <stop offset="1" stopColor="#8bcc48" />
            </linearGradient>
          ))}
        </defs>
        <g
          className="signal-labels"
          fill="#385f69"
          fontSize="12"
          fontFamily="monospace"
          letterSpacing="1.4"
        >
          <text x="543" y="59">
            МИМИКА
          </text>
          <text x="819" y="148">
            ЖЕСТЫ
          </text>
          <path
            d="M543 120V70H597 M747 70H800V120 M543 344V395H593 M819 189V159H850 M944 159H978V189 M978 371V403H948"
            fill="none"
            stroke="#a6c7c8"
            strokeWidth="1.3"
          />
        </g>
        <g
          className="signal-scene"
          stroke="#42626e"
          strokeWidth="1.55"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path
            d="M437 526 Q445 486 478 468 L574 432 Q610 420 612 391 L615 343 L740 343 L743 391 Q745 418 774 430 L872 467 L929 526"
            fill="url(#skin)"
          />
          <g className="signal-head">
            <path
              d="M674 73 C624 73 585 100 572 145 C563 174 567 211 578 245
              C582 272 586 303 596 326 Q619 365 651 383 Q674 396 699 383
              Q736 364 754 326 C765 297 768 269 774 239 C785 190 782 151 765 123
              Q738 73 674 73 Z"
              fill="url(#skin)"
            />
            {/* Черты лица видны с появлением силуэта. Сетка строится поверх них. */}
            <g fill="none" stroke="#44626c" strokeWidth="1.6">
              {/* Брови и веки отражены относительно середины лица (x = 674). */}
              {["translate(0)", "translate(1348 0) scale(-1 1)"].map((side) => (
                <g key={side} transform={side}>
                  <path d="M594 216 Q606 202 616 199 Q635 201 656 208 L653 215 Q632 210 617 205 Q605 207 594 216Z" />
                  <path d="M609 235 Q628 215 650 237 Q632 248 609 235Z" />
                  <circle cx="630" cy="234" r="7.5" strokeWidth="1.35" />
                </g>
              ))}
              <path d="M665 239 Q666 260 662 283 M650 289 Q652 298 660 294 Q665 292 668 297 Q674 302 680 297 Q683 292 688 294 Q696 298 698 289" />
              <path d="M640 329 Q656 322 669 317 Q674 321 679 317 Q693 321 708 329 Q695 342 688 344 Q674 348 660 344 Q648 337 640 329Z M640 329 Q653 330 661 328 Q674 334 687 328 Q697 330 708 329" />
            </g>
            <Landmarks points={face} lines={faceLines} tone="face" />
          </g>
          <g className="signal-arm">
            <path
              d="M872 526 L867 424 Q866 398 854 381 L834 347 Q827 337 823 317
              L813 280 Q811 270 820 270 Q828 270 832 280 L846 311 Q854 325 855 309
              L850 200 Q849 187 857 187 Q865 186 867 199 L878 265 Q880 277 885 261
              L894 184 Q896 171 904 174 Q912 175 910 188 L904 265 Q904 280 910 269
              L923 199 Q925 187 934 191 Q941 193 938 205 L929 278 Q928 296 935 281
              L952 238 Q956 229 962 233 Q969 237 965 247 L950 303 Q945 348 933 380
              Q928 394 936 421 L962 526"
              fill="url(#skin)"
            />
            <Landmarks points={hand} lines={handLines} tone="hand" />
          </g>
        </g>
      </svg>
    </figure>
  );
}
