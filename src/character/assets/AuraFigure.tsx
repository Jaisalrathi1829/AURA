/**
 * AURA — original character artwork, built as a rig rather than a picture.
 *
 * Proportions follow standard adult female head construction: the eyes sit on
 * the vertical midline of the head, are one eye-width apart, and the iris is
 * roughly a fifth of the eye's width — getting those three wrong is what makes
 * a drawn face read as cartoon rather than person, so they are the numbers to
 * preserve if this file is edited.
 *
 * Every part that moves is its own element with a stable class name; the
 * animation driver writes CSS custom properties onto an ancestor and the
 * transforms in `character.css` read them. Nothing here re-renders during
 * animation.
 *
 * Rig contract (classes consumed by character.css):
 *   .rig-body      whole-figure sway + breath
 *   .rig-chest     breathing volume
 *   .rig-head      yaw + tilt
 *   .rig-iris-*    gaze
 *   .rig-lid-*     blink — a skin-toned plate whose lower edge is the eyelid
 *   .rig-brow-*    brow raise / furrow
 *   .rig-mouth-*   neutral vs smiling mouth cross-fade
 *   .rig-jaw       mouth opening
 *   .rig-glow      ambient presence
 */

export function AuraFigure() {
  return (
    <svg
      className="aura-figure"
      viewBox="0 0 300 440"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="AURA"
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <linearGradient id="skin" x1="0.32" y1="0.05" x2="0.78" y2="1">
          <stop offset="0%" stopColor="#FBE7DC" />
          <stop offset="40%" stopColor="#F5D9C9" />
          <stop offset="78%" stopColor="#EAC3AE" />
          <stop offset="100%" stopColor="#DCB09B" />
        </linearGradient>

        <linearGradient id="skinNeck" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#CE9C86" />
          <stop offset="40%" stopColor="#E6BEA8" />
          <stop offset="100%" stopColor="#EFCDB9" />
        </linearGradient>

        <radialGradient id="cheek" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#E39A85" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#E39A85" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="faceShade" x1="0.5" y1="0.35" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#C08A72" stopOpacity="0" />
          <stop offset="100%" stopColor="#B87F67" stopOpacity="0.4" />
        </linearGradient>

        <linearGradient id="hairBack" x1="0.18" y1="0" x2="0.92" y2="0.85">
          <stop offset="0%" stopColor="#CFA85F" />
          <stop offset="34%" stopColor="#B5904A" />
          <stop offset="72%" stopColor="#8E6F35" />
          <stop offset="100%" stopColor="#6E5426" />
        </linearGradient>

        <linearGradient id="hairMid" x1="0.2" y1="0" x2="0.85" y2="0.9">
          <stop offset="0%" stopColor="#E7CB86" />
          <stop offset="45%" stopColor="#C9A659" />
          <stop offset="100%" stopColor="#9A7A3B" />
        </linearGradient>

        <linearGradient id="hairTop" x1="0.25" y1="0" x2="0.8" y2="0.8">
          <stop offset="0%" stopColor="#F6E3AC" />
          <stop offset="40%" stopColor="#DFBF74" />
          <stop offset="100%" stopColor="#B18F49" />
        </linearGradient>

        <linearGradient id="hairSheen" x1="0" y1="0" x2="0.9" y2="0.5">
          <stop offset="0%" stopColor="#FFF7DA" stopOpacity="0" />
          <stop offset="50%" stopColor="#FFF7DA" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#FFF7DA" stopOpacity="0" />
        </linearGradient>

        <radialGradient id="iris" cx="0.4" cy="0.34" r="0.75">
          <stop offset="0%" stopColor="#E4F0FA" />
          <stop offset="30%" stopColor="#A9C7E0" />
          <stop offset="66%" stopColor="#7599BC" />
          <stop offset="100%" stopColor="#405F79" />
        </radialGradient>

        <linearGradient id="sclera" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#CFD9E3" />
          <stop offset="40%" stopColor="#F8FBFE" />
          <stop offset="100%" stopColor="#E3EAF1" />
        </linearGradient>

        <linearGradient id="outfit" x1="0.32" y1="0" x2="0.82" y2="1">
          <stop offset="0%" stopColor="#2C333C" />
          <stop offset="48%" stopColor="#1A1F27" />
          <stop offset="100%" stopColor="#0A0D12" />
        </linearGradient>

        <linearGradient id="outfitRim" x1="0" y1="0.1" x2="1" y2="0.8">
          <stop offset="0%" stopColor="#A6D6F8" stopOpacity="0.3" />
          <stop offset="26%" stopColor="#A6D6F8" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#A6D6F8" stopOpacity="0" />
        </linearGradient>

        <linearGradient id="lipGrad" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#C4796F" />
          <stop offset="46%" stopColor="#B76A61" />
          <stop offset="100%" stopColor="#A05450" />
        </linearGradient>

        <radialGradient id="ambient" cx="0.5" cy="0.46" r="0.5">
          <stop offset="0%" stopColor="#9BD4FF" stopOpacity="0.26" />
          <stop offset="58%" stopColor="#6FA8DC" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#4E7FB0" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="floor" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#A8DCFF" stopOpacity="0.3" />
          <stop offset="58%" stopColor="#79B4E4" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#79B4E4" stopOpacity="0" />
        </radialGradient>

        {/* Eye interiors are clipped, so the lid plate simply slides down. */}
        {/* The opening is ~13 tall for 23 wide. Any taller and the sclera shows
            all round the iris, which is the single biggest "cartoon" tell. */}
        <clipPath id="clipEyeL">
          <path d="M118 123.6 C120.8 118.6 124.6 116.6 129.4 116.6 C134.4 116.6 138.4 119 141 123.4 C138.4 127.6 134.4 129.8 129.2 129.8 C124.2 129.8 120.2 127.8 118 123.6 Z" />
        </clipPath>
        <clipPath id="clipEyeR">
          <path d="M182 123.6 C179.2 118.6 175.4 116.6 170.6 116.6 C165.6 116.6 161.6 119 159 123.4 C161.6 127.6 165.6 129.8 170.8 129.8 C175.8 129.8 179.8 127.8 182 123.6 Z" />
        </clipPath>
        <clipPath id="clipHairBack">
          <path d="M150 28 C198 28 226 62 228 110 C230 148 226 186 224 222 C222 258 224 292 230 322 C234 344 238 360 240 372 L212 362 C208 332 204 300 202 266 C200 232 202 200 200 172 L100 172 C98 200 100 232 98 266 C96 300 92 332 88 362 L60 372 C62 360 66 344 70 322 C76 292 78 258 76 222 C74 186 70 148 72 110 C74 62 102 28 150 28 Z" />
        </clipPath>
        <clipPath id="clipFace">
          <path d="M150 46 C177 46 195 61 200 88 C204 111 202 133 198 152 C194 171 185 188 172 196 C165 201 157 203 150 203 C143 203 135 201 128 196 C115 188 106 171 102 152 C98 133 96 111 100 88 C105 61 123 46 150 46 Z" />
        </clipPath>
      </defs>

      {/* Ambient presence. Deliberately outside every animated group — this
          layer never moves, so it never needs recompositing. */}
      <g className="rig-glow">
        <ellipse cx="150" cy="200" rx="130" ry="160" fill="url(#ambient)" />
        <ellipse cx="150" cy="426" rx="112" ry="18" fill="url(#floor)" />
      </g>

      <g className="rig-body">
        {/* ---------------------------------------------------- hair (back) */}
        <g className="hair-back">
          <path
            d="M150 28 C198 28 226 62 228 110 C230 148 226 186 224 222 C222 258 224 292 230 322 C234 344 238 360 240 372 L212 362 C208 332 204 300 202 266 C200 232 202 200 200 172 L100 172 C98 200 100 232 98 266 C96 300 92 332 88 362 L60 372 C62 360 66 344 70 322 C76 292 78 258 76 222 C74 186 70 148 72 110 C74 62 102 28 150 28 Z"
            fill="url(#hairBack)"
          />
          <g clipPath="url(#clipHairBack)">
            <path
              d="M76 116 C84 190 82 288 72 372 L96 372 C106 288 106 190 96 116 Z"
              fill="url(#hairSheen)"
              opacity="0.45"
            />
            <path
              d="M208 126 C216 200 216 296 206 372 L224 372 C234 296 232 200 222 126 Z"
              fill="url(#hairSheen)"
              opacity="0.3"
            />
            {/* Strand separations: without these the mass reads as a slab. */}
            <path d="M84 168 C90 240 90 312 84 372" stroke="#6E5426" strokeWidth="1.5" strokeOpacity="0.45" fill="none" />
            <path d="M92 200 C97 262 97 322 92 372" stroke="#6E5426" strokeWidth="1.1" strokeOpacity="0.3" fill="none" />
            <path d="M214 176 C220 246 220 314 214 372" stroke="#6E5426" strokeWidth="1.5" strokeOpacity="0.42" fill="none" />
            <path d="M206 206 C211 266 211 324 206 372" stroke="#6E5426" strokeWidth="1.1" strokeOpacity="0.28" fill="none" />
          </g>
        </g>

        {/* -------------------------------------------------------- torso */}
        <g className="rig-chest">
          {/* Trapezius slope into the shoulder, then upper arms — not a dome. */}
          <path
            d="M150 230 C165 230 176 234 186 240 C201 249 217 261 228 277 C239 293 246 315 249 339 C253 373 255 409 255 440 L45 440 C45 409 47 373 51 339 C54 315 61 293 72 277 C83 261 99 249 114 240 C124 234 135 230 150 230 Z"
            fill="url(#outfit)"
          />
          <path
            d="M150 230 C165 230 176 234 186 240 C201 249 217 261 228 277 C239 293 246 315 249 339 C253 373 255 409 255 440 L45 440 C45 409 47 373 51 339 C54 315 61 293 72 277 C83 261 99 249 114 240 C124 234 135 230 150 230 Z"
            fill="url(#outfitRim)"
          />

          {/* A high, professional neckline — just enough skin to seat the head
              on the body, no plunge. */}
          <path
            d="M131 233 C136 246 143 251 150 251 C157 251 164 246 169 233 C163 238 137 238 131 233 Z"
            fill="url(#skinNeck)"
            opacity="0.95"
          />
          {/* Collarbone hints — small, but they stop the chest reading flat. */}
          <path d="M132 246 C140 252 146 254 150 254" stroke="#C08A72" strokeOpacity="0.3" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          <path d="M168 246 C160 252 154 254 150 254" stroke="#C08A72" strokeOpacity="0.3" strokeWidth="1.3" fill="none" strokeLinecap="round" />

          {/* Understated sci-fi detailing: lit seams, not neon piping. */}
          <path d="M113 241 C124 254 132 262 138 268" stroke="#8FD0FF" strokeOpacity="0.2" strokeWidth="1" fill="none" />
          <path d="M187 241 C176 254 168 262 162 268" stroke="#8FD0FF" strokeOpacity="0.2" strokeWidth="1" fill="none" />
          <path d="M67 302 C82 284 98 270 114 262" stroke="#8FD0FF" strokeOpacity="0.16" strokeWidth="1" fill="none" />
          <path d="M233 302 C218 284 202 270 186 262" stroke="#8FD0FF" strokeOpacity="0.16" strokeWidth="1" fill="none" />
          <path d="M150 276 L150 440" stroke="#8FD0FF" strokeOpacity="0.07" strokeWidth="1" fill="none" />
          {/* Arm seams give the silhouette shoulders instead of a bell. */}
          <path d="M82 296 C78 336 76 390 76 440" stroke="#000000" strokeOpacity="0.4" strokeWidth="2" fill="none" />
          <path d="M218 296 C222 336 224 390 224 440" stroke="#000000" strokeOpacity="0.4" strokeWidth="2" fill="none" />

          {/* The one point of real light on the outfit. */}
          <circle className="rig-core-halo" cx="150" cy="270" r="7" fill="#8FD0FF" opacity="0.26" />
          <circle className="rig-core" cx="150" cy="270" r="2.6" fill="#DCF2FF" />

          {/* Rim light down the figure's left contour. */}
          <path
            d="M113 241 C95 250 79 262 67 277 C55 293 47 315 43 339"
            stroke="#CFEAFF"
            strokeOpacity="0.26"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </g>

        {/* --------------------------------------------------------- neck */}
        <path
          d="M135 182 C135 206 133 224 128 238 L172 238 C167 224 165 206 165 182 Z"
          fill="url(#skinNeck)"
        />
        {/* Shadow the jaw casts on the neck — the main depth cue for the head.
            Kept soft: too dark and it reads as a chin strap. */}
        <path
          d="M135 182 C135 198 134 208 132 216 C140 222 160 222 168 216 C166 208 165 198 165 182 Z"
          fill="#A8735C"
          opacity="0.2"
        />

        {/* --------------------------------------------------------- head */}
        <g className="rig-head">
          <path d="M100 116 C93 114 89 123 92 134 C95 145 100 149 104 145 Z" fill="#EEC6B1" />
          <path d="M200 116 C207 114 211 123 208 134 C205 145 200 149 196 145 Z" fill="#EEC6B1" />

          {/* Head: ~1.5 tall for 1 wide, with the taper carried into the jaw. */}
          <path
            className="face"
            d="M150 46 C177 46 195 61 200 88 C204 111 202 133 198 152 C194 171 185 188 172 196 C165 201 157 203 150 203 C143 203 135 201 128 196 C115 188 106 171 102 152 C98 133 96 111 100 88 C105 61 123 46 150 46 Z"
            fill="url(#skin)"
          />

          <g clipPath="url(#clipFace)">
            <rect x="94" y="150" width="112" height="60" fill="url(#faceShade)" />
            {/* Temple and cheekbone shading. */}
            <ellipse cx="106" cy="112" rx="14" ry="26" fill="#C98F77" opacity="0.2" />
            <ellipse cx="194" cy="112" rx="14" ry="26" fill="#C98F77" opacity="0.2" />
            <ellipse cx="119" cy="146" rx="16" ry="11" fill="url(#cheek)" />
            <ellipse cx="181" cy="146" rx="16" ry="11" fill="url(#cheek)" />
            {/* Light down the centre of the face. */}
            <ellipse cx="150" cy="120" rx="26" ry="46" fill="#FFF1E6" opacity="0.16" />
          </g>

          {/* ------------------------------------------------------- nose */}
          {/* Implied with two shadows and a nostril hint — a drawn outline is
              what makes a stylised nose read as a cartoon. */}
          <path
            d="M146.6 130 C144.6 141 143.6 150 145.6 155.4"
            fill="none"
            stroke="#CE9A82"
            strokeOpacity="0.42"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <ellipse cx="150" cy="155" rx="6.6" ry="3.8" fill="#E0AF97" opacity="0.34" />
          <path
            d="M143.6 157.6 C145.8 159.8 148 160.2 149.6 159.2"
            fill="none"
            stroke="#B8836B"
            strokeOpacity="0.5"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <path
            d="M156.4 157.6 C154.2 159.8 152 160.2 150.4 159.2"
            fill="none"
            stroke="#B8836B"
            strokeOpacity="0.5"
            strokeWidth="1.3"
            strokeLinecap="round"
          />

          {/* ------------------------------------------------------- eyes */}
          <g className="eyes">
            {/* Socket shading, then the eye itself. */}
            <ellipse cx="129.4" cy="122" rx="18" ry="12" fill="#CE9E86" opacity="0.24" />
            <ellipse cx="170.6" cy="122" rx="18" ry="12" fill="#CE9E86" opacity="0.24" />

            <g clipPath="url(#clipEyeL)">
              <rect x="116" y="112" width="28" height="22" fill="url(#sclera)" />
              {/* Iris ~5.5 radius against a 23-wide eye: the ratio that keeps
                  the face adult rather than doll-like. */}
              <g className="rig-iris-l">
                <circle cx="129.4" cy="123" r="5.6" fill="url(#iris)" />
                <circle cx="129.4" cy="123" r="5.6" fill="none" stroke="#2C4760" strokeWidth="1" strokeOpacity="0.85" />
                <circle cx="129.4" cy="123" r="3.6" fill="none" stroke="#CDEBFF" strokeWidth="0.5" strokeOpacity="0.35" />
                <circle cx="129.4" cy="123" r="2.3" fill="#0E1720" />
                <circle cx="127.6" cy="121.1" r="1.5" fill="#FFFFFF" opacity="0.95" />
                <circle cx="131.4" cy="125.2" r="0.8" fill="#FFFFFF" opacity="0.5" />
              </g>
              <ellipse cx="129.4" cy="114" rx="18" ry="7" fill="#A97258" opacity="0.36" />
              <g className="rig-lid-l">
                <path
                  d="M113 92 L146 92 L146 125 C143.4 119.4 137.4 116.6 129.4 116.6 C121.6 116.6 116 119.2 113 125 Z"
                  fill="url(#skin)"
                />
                <path
                  d="M113 125 C116 119.2 121.6 116.6 129.4 116.6 C137.4 116.6 143.4 119.4 146 125"
                  fill="none"
                  stroke="#4A3426"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                />
              </g>
            </g>

            <g clipPath="url(#clipEyeR)">
              <rect x="156" y="112" width="28" height="22" fill="url(#sclera)" />
              <g className="rig-iris-r">
                <circle cx="170.6" cy="123" r="5.6" fill="url(#iris)" />
                <circle cx="170.6" cy="123" r="5.6" fill="none" stroke="#2C4760" strokeWidth="1" strokeOpacity="0.85" />
                <circle cx="170.6" cy="123" r="3.6" fill="none" stroke="#CDEBFF" strokeWidth="0.5" strokeOpacity="0.35" />
                <circle cx="170.6" cy="123" r="2.3" fill="#0E1720" />
                <circle cx="168.8" cy="121.1" r="1.5" fill="#FFFFFF" opacity="0.95" />
                <circle cx="172.6" cy="125.2" r="0.8" fill="#FFFFFF" opacity="0.5" />
              </g>
              <ellipse cx="170.6" cy="114" rx="18" ry="7" fill="#A97258" opacity="0.36" />
              <g className="rig-lid-r">
                <path
                  d="M154 92 L187 92 L187 125 C184 119.2 178.4 116.6 170.6 116.6 C162.6 116.6 156.6 119.4 154 125 Z"
                  fill="url(#skin)"
                />
                <path
                  d="M154 125 C156.6 119.4 162.6 116.6 170.6 116.6 C178.4 116.6 184 119.2 187 125"
                  fill="none"
                  stroke="#4A3426"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                />
              </g>
            </g>

            {/* Lid creases — a small line that adds a lot of realism. */}
            <path d="M117.6 116.4 C121.4 110.6 126 108 131 108.4" fill="none" stroke="#C08E76" strokeOpacity="0.45" strokeWidth="1.1" strokeLinecap="round" />
            <path d="M182.4 116.4 C178.6 110.6 174 108 169 108.4" fill="none" stroke="#C08E76" strokeOpacity="0.45" strokeWidth="1.1" strokeLinecap="round" />

            {/* Lower lash lines, over the clip so they always read. */}
            <path d="M119 126.6 C122.6 129.2 125.8 130 129.4 130 C133 130 136.6 129 139.6 126.4" fill="none" stroke="#7C5B43" strokeOpacity="0.45" strokeWidth="1.1" strokeLinecap="round" />
            <path d="M181 126.6 C177.4 129.2 174.2 130 170.6 130 C167 130 163.4 129 160.4 126.4" fill="none" stroke="#7C5B43" strokeOpacity="0.45" strokeWidth="1.1" strokeLinecap="round" />
            {/* A whisper of shadow under the eye. */}
            <path d="M120 132 C125 134.4 135 134.4 139.6 131.6" fill="none" stroke="#C08E76" strokeOpacity="0.26" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M180 132 C175 134.4 165 134.4 160.4 131.6" fill="none" stroke="#C08E76" strokeOpacity="0.26" strokeWidth="1.4" strokeLinecap="round" />
          </g>

          {/* ------------------------------------------------------ brows */}
          {/* Filled and tapered rather than stroked — a constant-width brow is
              the other classic tell of a drawn face. */}
          <g className="rig-brow-l">
            <path
              d="M142.6 100.4 C134.6 96.2 123.4 98.2 116.2 106.4 L117.8 107.6 C124.6 100.6 134.2 99.4 141.4 103.4 Z"
              fill="#A0813F"
              opacity="0.92"
            />
          </g>
          <g className="rig-brow-r">
            <path
              d="M157.4 100.4 C165.4 96.2 176.6 98.2 183.8 106.4 L182.2 107.6 C175.4 100.6 165.8 99.4 158.6 103.4 Z"
              fill="#A0813F"
              opacity="0.92"
            />
          </g>

          {/* ------------------------------------------------------ mouth */}
          <g className="mouth">
            <g className="rig-jaw">
              <ellipse cx="150" cy="177" rx="10" ry="5.6" fill="#5C2E30" />
              <ellipse cx="150" cy="174.6" rx="8.4" ry="2" fill="#F5F2ED" opacity="0.8" />
            </g>

            {/* Neutral and smiling mouths cross-fade, so a smile is a real
                shape change rather than a stretched copy of the same one. */}
            <g className="rig-mouth-neutral">
              <path
                d="M136 174 C139.4 170.4 143.6 169.4 146.4 171.6 C148 172.8 149 173.2 150 173.2 C151 173.2 152 172.8 153.6 171.6 C156.4 169.4 160.6 170.4 164 174 C157.4 176.6 142.6 176.6 136 174 Z"
                fill="url(#lipGrad)"
              />
              <path
                className="lip-lower"
                d="M136.4 174.4 C142.6 182 157.4 182 163.6 174.4 C157.4 178.4 142.6 178.4 136.4 174.4 Z"
                fill="url(#lipGrad)"
                opacity="0.94"
              />
              <path d="M136 174 C142.6 172 157.4 172 164 174" fill="none" stroke="#8A4744" strokeOpacity="0.65" strokeWidth="1" />
            </g>

            <g className="rig-mouth-smile">
              <path
                d="M133 170.6 C137 167 142.6 166.4 146 168.8 C147.8 170 149 170.4 150 170.4 C151 170.4 152.2 170 154 168.8 C157.4 166.4 163 167 167 170.6 C159.4 174.4 140.6 174.4 133 170.6 Z"
                fill="url(#lipGrad)"
              />
              <path
                className="lip-lower"
                d="M133.4 171 C140.6 182 159.4 182 166.6 171 C159.4 176.6 140.6 176.6 133.4 171 Z"
                fill="url(#lipGrad)"
                opacity="0.94"
              />
              <path d="M133 170.6 C140.6 169.6 159.4 169.6 167 170.6" fill="none" stroke="#8A4744" strokeOpacity="0.65" strokeWidth="1" />
              {/* Corner shadows: what actually sells a smile at this scale. */}
              <path d="M132 170.4 C133.6 172.6 135.6 173.8 137.6 174.2" fill="none" stroke="#B8836B" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
              <path d="M168 170.4 C166.4 172.6 164.4 173.8 162.4 174.2" fill="none" stroke="#B8836B" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
            </g>

            {/* Philtrum. */}
            <path d="M147.4 163 C148.4 166.6 148.6 168.6 148.6 170.4" fill="none" stroke="#CE9A82" strokeOpacity="0.28" strokeWidth="1" strokeLinecap="round" />
            <path d="M152.6 163 C151.6 166.6 151.4 168.6 151.4 170.4" fill="none" stroke="#CE9A82" strokeOpacity="0.28" strokeWidth="1" strokeLinecap="round" />
            {/* Chin shadow. */}
            <path d="M141 187 C145 190 155 190 159 187" fill="none" stroke="#C08E76" strokeOpacity="0.3" strokeWidth="1.6" strokeLinecap="round" />
          </g>

          {/* -------------------------------------------------- hair front */}
          <g className="hair-front">
            {/* Crown volume above the hairline. */}
            <path
              d="M150 30 C192 30 220 60 224 104 C218 84 208 68 194 58 C180 48 166 44 150 44 C134 44 120 48 106 58 C92 68 82 84 76 104 C80 60 108 30 150 30 Z"
              fill="url(#hairTop)"
            />
            {/* Side-swept fringe sitting over the forehead. */}
            <path
              d="M150 32 C190 32 218 60 223 100 C214 80 200 66 180 60 C163 55 146 60 131 71 C117 81 106 94 99 108 C95 82 104 56 124 42 C132 36 141 32 150 32 Z"
              fill="url(#hairMid)"
            />
            {/* Locks framing and overlapping the face on both sides. */}
            <path
              d="M99 104 C93 134 94 168 101 196 C105 212 109 226 111 240 C103 224 94 204 90 182 C85 154 87 126 99 104 Z"
              fill="url(#hairMid)"
            />
            <path
              d="M223 100 C230 132 229 168 222 196 C218 212 214 226 212 240 C220 224 229 204 233 182 C238 152 236 124 223 100 Z"
              fill="url(#hairMid)"
            />
            {/* A thinner lock crossing the temple — breaks the helmet look. */}
            <path
              d="M182 60 C192 68 200 80 205 94 C199 84 190 74 178 68 Z"
              fill="url(#hairTop)"
              opacity="0.85"
            />
            <path
              d="M120 50 C110 60 102 74 98 90 C102 74 111 60 124 52 Z"
              fill="url(#hairTop)"
              opacity="0.8"
            />
            {/* Sheen band and strand lines. */}
            <path
              d="M118 48 C136 36 166 36 188 50 C168 44 140 46 124 56 Z"
              fill="#FFF7DA"
              opacity="0.45"
            />
            <path d="M126 52 C146 40 174 44 194 60" fill="none" stroke="#FFF7DA" strokeOpacity="0.32" strokeWidth="1.3" />
            <path d="M108 78 C120 62 138 52 158 50" fill="none" stroke="#8E6F35" strokeOpacity="0.35" strokeWidth="1.1" />
            <path d="M101 100 C106 80 118 64 134 54" fill="none" stroke="#8E6F35" strokeOpacity="0.28" strokeWidth="1.1" />
            <path d="M206 96 C202 78 192 64 178 56" fill="none" stroke="#8E6F35" strokeOpacity="0.26" strokeWidth="1.1" />
          </g>

          {/* Rim light along the head's left contour, last so it reads on top. */}
          <path
            d="M99 112 C94 84 106 54 126 42"
            fill="none"
            stroke="#DCEFFF"
            strokeOpacity="0.4"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M104 178 C97 162 93 142 93 124"
            fill="none"
            stroke="#DCEFFF"
            strokeOpacity="0.18"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
}
