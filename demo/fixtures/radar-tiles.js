// Offline map and radar tiles for the fictional Lakewood forecast. The dashboard
// requests these the same way it requests basemap tiles and RainViewer frames.
const tileSize = 256;
const home = {lat: 39.7047, lon: -105.0814};

function worldPoint(z) {
  const world = tileSize * 2 ** z;
  const radians = home.lat * Math.PI / 180;
  return [
    (home.lon + 180) / 360 * world,
    (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * world,
  ];
}

function tile(z, x, y, contents) {
  const [homeX, homeY] = worldPoint(z);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"
    viewBox="${x * tileSize - homeX} ${y * tileSize - homeY} 256 256">${contents}</svg>`;
}

function basemap(z, x, y) {
  const streets = [-288, -239, -188, -142, -102, -64, -23, 20, 57, 105, 148, 197, 240, 286, 334];
  const grid = streets.map(n => `M-24 ${n}H880 M${n + 195} -570V550`).join(" ");
  return tile(z, x, y, `
    <path fill="#f0efe9" d="M-1000 -1000H1000V1000H-1000Z"/>
    <path fill="#c8ddbe" d="M-1000 -1000H-290L-238 -470 -145 -371 -159 -292 -65 -222 -113 -143
      -98 -78 -165 -15 -113 50 -180 131 -91 185 -138 264 -47 380 -154 489 -110 1000H-1000Z"/>
    <path fill="#dbe1d8" d="M-68 -125L52 -225 162 -179 318 -249 567 -149 550 217 320 259
      166 184 12 205 -77 106 -43 32Z"/>
    <path fill="none" stroke="#adbfa5" stroke-width="1.5" opacity=".65"
      d="M-850 -450Q-470 -270 -150 -471M-860 -381Q-575 -175 -246 -389
      M-850 -270Q-603 -87 -241 -279M-891 -165Q-511 55 -160 -180M-864 -43Q-596 133 -176 -82
      M-905 105Q-667 217 -213 12M-900 241Q-616 342 -178 125M-847 351Q-462 396 -162 243
      M-848 467Q-637 547 -90 360"/>
    <path fill="none" stroke="#b4c1b8" stroke-width="1.5" opacity=".8" d="${grid}"/>
    <path fill="none" stroke="#87b5d8" stroke-width="4" d="M-690 169Q-384 147 -238 171T49 111
      Q142 100 161 3T333 -201L380 -443"/>
    <path fill="none" stroke="#91b9d8" stroke-width="6" d="M-221 239q-40 20 -43 51q19 21 56 1q30 -34 -13 -52z"/>
    <path fill="none" stroke="#d3a77c" stroke-width="7" d="M-710 94Q-454 18 -280 19T42 3
      Q115 9 210 -44T815 -123M105 -560Q105 -225 151 -138T178 70Q158 214 259 550"/>
    <path fill="none" stroke="#f7e2a0" stroke-width="4" d="M-710 94Q-454 18 -280 19T42 3
      Q115 9 210 -44T815 -123M105 -560Q105 -225 151 -138T178 70Q158 214 259 550"/>
    <g fill="#42534c" font-family="system-ui,sans-serif" font-size="17" font-weight="650">
      <text x="12" y="-14">Lakewood</text><text x="146" y="-87">Denver</text>
      <text x="-118" y="-63">Golden</text><text x="-16" y="124">Littleton</text>
      <text x="-376" y="122" font-size="15" font-weight="500">Front Range</text>
    </g>`);
}

function radarFrame(z, x, y, frame) {
  const front = -125 + frame * 17;
  return tile(z, x, y, `
    <g transform="translate(${front} -22) rotate(9)">
      <path fill="#419fff" fill-opacity=".55" d="M-300 -156Q-257 -168 -201 -135T-94 -138
        Q-55 -124 -61 -94Q-17 -88 -27 -50Q9 -28 -4 15Q23 46 -16 71Q-12 101 -74 105
        Q-110 153 -173 125Q-248 143 -302 86T-300 -156Z"/>
      <path fill="#25c8dd" fill-opacity=".76" d="M-246 -136Q-198 -100 -151 -116T-76 -78
        Q-53 -58 -59 -37Q-19 -22 -38 19Q-17 51 -57 69Q-73 111 -138 89
        Q-199 125 -246 73Q-285 35 -268 -17Q-283 -76 -246 -136Z"/>
      <path fill="#4cdd8b" fill-opacity=".9" d="M-191 -104Q-139 -91 -108 -74
        Q-97 -55 -112 -44Q-76 -33 -86 -10Q-57 23 -99 49Q-114 79 -164 63
        Q-207 77 -219 42Q-257 2 -219 -28Q-241 -72 -191 -104Z"/>
      <path fill="#e9e85d" d="M-171 -60Q-126 -72 -143 -38Q-158 -14 -179 -26
        Q-216 -24 -197 -52Z M-150 7Q-124 -5 -117 18Q-125 42 -149 42Q-174 29 -150 7Z"/>
    </g>`);
}

module.exports = {basemap, radarFrame};
