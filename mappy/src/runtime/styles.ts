/*
  styles.ts - Mappy's stylesheet, injected once into the page head. Every class is prefixed
  "mappy-" so nothing leaks into the app. Bubble colors come from CSS variables set inline,
  so the classic yellow bubble and the theme-colored bubble share one stylesheet.

  Accessibility (WCAG 2.2 AA): sizes in rem so text scales; every control at least 28 px
  (2.5.8); focus rings 2 px with offset in a color checked for 3:1 (2.4.7, 1.4.11); borders
  and dividers 3:1 (1.4.11); the bubble reflows to the tab width at 320 px (1.4.10); all
  motion stops under prefers-reduced-motion or the "Pause animation" menu item (2.2.2, 2.3.3).
*/

import { ACT_CSS } from './components/Acts'

const CSS = `
.mappy-head-drag{cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.mappy-head-drag:active{cursor:grabbing}
.mappy-head-drag button{cursor:pointer}
.mappy-task{flex:0 0 auto;border-bottom:1px solid var(--mappy-line);font-size:.75rem;max-height:38%;overflow:auto}
.mappy-task summary{cursor:pointer;padding:8px 12px;overflow-wrap:anywhere;min-height:32px}
.mappy-task summary:focus-visible{outline:2px solid currentColor;outline-offset:-3px}
.mappy-task-heading{font-weight:600;margin-right:5px}
.mappy-task-meta{display:block;font-size:.7rem;margin-top:3px}
.mappy-task-body{padding:0 12px 10px;overflow-wrap:anywhere}
.mappy-task-body dl{margin:4px 0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px}
.mappy-task-body dt{font-weight:600}.mappy-task-body dd{margin:0}
.mappy-task-body p{font-size:.68rem;margin:8px 0}
.mappy-task-actions{display:flex;flex-wrap:wrap;gap:5px}
.mappy-toolbar{display:flex;flex-wrap:wrap;gap:5px;padding:8px 10px;border-bottom:1px solid var(--mappy-line)}
.mappy-toolbar .mappy-chip{font-size:.7rem;padding:2px 8px}
.mappy-msg p{white-space:pre-wrap}
.mappy-table-wrap{overflow:auto;max-width:100%;margin:8px 0;border:1px solid var(--mappy-line);border-radius:6px}
.mappy-table{border-collapse:collapse;width:100%;font-size:.8rem;font-variant-numeric:tabular-nums}
.mappy-table th,.mappy-table td{text-align:left;padding:6px 8px;min-width:7rem;max-width:18rem;border-bottom:1px solid var(--mappy-line);overflow-wrap:anywhere}
.mappy-table th{background:var(--mappy-user-bg);font-weight:700}
.mappy-table tr:last-child td{border-bottom:0}
.mappy-sources{font-size:.72rem;color:var(--mappy-muted);margin:7px 0}
.mappy-sources summary{cursor:pointer;min-height:28px;padding-top:4px}
.mappy-sources div{padding:4px 8px;border-left:2px solid var(--mappy-line)}
.mappy-chip:disabled,.mappy-iconbtn:disabled{opacity:.6;cursor:default}
.mappy-row:disabled{cursor:default}
.mappy-row:disabled:hover{background:transparent}
.mappy-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000}
.mappy-layer>*{pointer-events:auto}
.mappy-char-wrap{position:fixed;touch-action:none}
.mappy-inline{position:relative;width:100%;height:100%;display:flex;justify-content:flex-end;align-items:flex-end;overflow:visible}
.mappy-char{cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none;outline:none;position:relative;display:block;border-radius:14px;background:transparent;border:0;padding:0}
.mappy-char:focus-visible{outline:2px solid var(--mappy-focus,#0b57d0);outline-offset:4px;box-shadow:0 0 0 6px rgba(255,255,255,.85)}
.mappy-char.mappy-dragging{cursor:grabbing}
.mappy-char svg{display:block;overflow:visible}
.mappy-shadow{fill:#000;opacity:.16;transform-origin:50px 104px;transform-box:view-box;animation:mappy-shadow 3.2s ease-in-out infinite}
.mappy-body{transform-origin:50px 100px;transform-box:view-box}
.mappy-eyes{transform-origin:50px 45px;transform-box:view-box;animation:mappy-blink 5.5s infinite}
.mappy-hand{transform-origin:88px 20px;transform-box:view-box;transition:transform .35s ease}
.mappy-arm{transform-box:view-box;transition:transform .35s ease,opacity .2s}
.mappy-mood-idle .mappy-body{animation:mappy-bob 3.2s ease-in-out infinite}
.mappy-mood-talk .mappy-body{animation:mappy-talk .5s ease-in-out 3}
.mappy-mood-wave .mappy-body{animation:mappy-bob 3.2s ease-in-out infinite}
.mappy-mood-wave .mappy-hand{animation:mappy-wave .45s ease-in-out 5}
.mappy-mood-happy .mappy-body,.mappy-mood-pleased .mappy-body{animation:mappy-hop .6s ease-out 2}
.mappy-mood-acknowledge .mappy-body{animation:mappy-nod .5s ease-in-out 2}
.mappy-mood-celebrate .mappy-body{animation:mappy-spin 1s ease-in-out 1}
.mappy-mood-celebrate .mappy-sparkle{animation:mappy-twinkle .8s ease-in-out infinite}
.mappy-mood-think .mappy-body{animation:mappy-tilt 2.4s ease-in-out infinite}
.mappy-mood-think .mappy-dots circle{animation:mappy-dot 1.2s ease-in-out infinite}
.mappy-mood-think .mappy-dots circle:nth-child(2){animation-delay:.2s}
.mappy-mood-think .mappy-dots circle:nth-child(3){animation-delay:.4s}
.mappy-mood-search .mappy-body{animation:mappy-scan 1.6s ease-in-out infinite}
.mappy-mood-search .mappy-glass{animation:mappy-scan 1.6s ease-in-out infinite;transform-box:view-box;transform-origin:84px 58px}
.mappy-mood-confused .mappy-body{animation:mappy-shake .5s ease-in-out 2}
.mappy-mood-sleep .mappy-body{animation:mappy-breathe 4s ease-in-out infinite}
.mappy-mood-sleep .mappy-zzz{animation:mappy-float 2.4s ease-in-out infinite}
.mappy-mood-attention .mappy-body{animation:mappy-bounce .7s ease-out 3}
.mappy-mood-attention .mappy-hand{animation:mappy-wave .45s ease-in-out 4}
.mappy-mood-listen .mappy-body{animation:mappy-lean 1.6s ease-in-out infinite}
.mappy-mood-point .mappy-body{animation:mappy-lunge .5s ease-out 1 both}
.mappy-enter .mappy-body{animation:mappy-unfold .7s cubic-bezier(.2,1.4,.4,1) 1 both}
.mappy-exit .mappy-body{animation:mappy-fold .45s ease-in 1 both}
.mappy-mood-talk .mappy-mouth{transform-origin:50px 64px;animation:mappy-chatter .32s ease-in-out 6}
.mappy-skit-peek .mappy-body{animation:mappy-peek 3.6s ease-in-out both}
.mappy-skit-stretch .mappy-body{animation:mappy-stretch 3.6s ease-in-out both}
.mappy-skit-stretch .mappy-hand{animation:mappy-wave .6s ease-in-out 4}
.mappy-skit-refold .mappy-body{animation:mappy-refold 3.6s ease-in-out both}
.mappy-skit-compass .mappy-body{animation:mappy-consult 3.6s ease-in-out both}
.mappy-compass{animation:mappy-prop 3.6s ease-in-out both;transform-origin:85px 78px;transform-box:view-box}
.mappy-needle{animation:mappy-compass-turn 3.6s ease-in-out both;transform-origin:85px 78px;transform-box:view-box}
@keyframes mappy-chatter{0%,100%{transform:scaleY(.7)}50%{transform:scaleY(1.35)}}
@keyframes mappy-peek{0%,100%{transform:none}20%,35%{transform:translateX(-5px) rotate(-12deg)}55%,70%{transform:translateX(5px) rotate(12deg)}85%{transform:translateY(-4px)}}
@keyframes mappy-stretch{0%,100%{transform:none}15%{transform:scale(1.1,.88)}35%,55%{transform:translateY(-6px) scale(.9,1.1)}75%{transform:scale(1.06,.95)}90%{transform:translateY(-2px)}}
@keyframes mappy-refold{0%,100%{transform:none}20%{transform:scaleX(.3) rotate(-8deg)}35%{transform:scaleX(.3) rotate(8deg)}55%{transform:scaleX(1.12) translateY(-8px)}70%{transform:scale(1.05,.92)}85%{transform:scale(.98,1.02)}}
@keyframes mappy-consult{0%,100%{transform:none}25%,70%{transform:rotate(7deg) translateY(2px)}82%{transform:rotate(-3deg)}}
@keyframes mappy-prop{0%,100%{opacity:0;transform:scale(.5)}15%,85%{opacity:1;transform:scale(1)}}
@keyframes mappy-compass-turn{0%{transform:rotate(-140deg)}30%{transform:rotate(95deg)}50%{transform:rotate(-30deg)}70%,100%{transform:rotate(0)}}
.mappy-leaner{transform-origin:50px 100px;transform-box:view-box;transition:transform .45s cubic-bezier(.3,1.5,.5,1)}
.mappy-cheek{transform-box:fill-box;transform-origin:center;transition:opacity .3s,transform .3s}
.mappy-hover .mappy-cheek,.mappy-mood-love .mappy-cheek,.mappy-mood-happy .mappy-cheek,.mappy-mood-pleased .mappy-cheek,.mappy-mood-excited .mappy-cheek{opacity:.95;transform:scale(1.35)}
.mappy-mood-love .mappy-cheek{animation:mappy-blush 1.1s ease-in-out infinite}
.mappy-pupils circle{transition:r .25s ease}
.mappy-hover.mappy-mood-idle .mappy-body{animation:mappy-wiggle .9s ease-in-out 1}
.mappy-hover.mappy-mood-idle .mappy-hand{animation:mappy-wave .4s ease-in-out 3}
.mappy-boop .mappy-body{animation:mappy-squish .45s cubic-bezier(.3,1.6,.5,1) 1!important}
.mappy-boop-heart{animation:mappy-boopheart .9s ease-out 1 both;transform-box:fill-box;transform-origin:center}
.mappy-dragging .mappy-body{animation:mappy-dangle .7s ease-in-out infinite!important}
.mappy-mood-love .mappy-body{animation:mappy-sway 1.4s ease-in-out infinite}
.mappy-mood-excited .mappy-body{animation:mappy-jitterhop .42s ease-in-out 5}
.mappy-mood-excited .mappy-hand{animation:mappy-wave .21s ease-in-out 10}
.mappy-heart{animation:mappy-heartup 2.2s ease-out infinite both;transform-box:fill-box;transform-origin:center;opacity:0}
.mappy-skit-heart .mappy-heart{animation-iteration-count:1}
.mappy-skit-heart .mappy-body{animation:mappy-sway 1.2s ease-in-out 3}
.mappy-confetti rect{animation:mappy-confetti 1.1s cubic-bezier(.2,.8,.4,1) 1 both;transform-box:fill-box;transform-origin:center}
.mappy-skit-dance .mappy-body{animation:mappy-dance 3.6s ease-in-out both}
.mappy-skit-dance .mappy-hand{animation:mappy-wave .3s ease-in-out 12}
.mappy-notes text{animation:mappy-float 1.2s ease-in-out 3}
.mappy-notes text:nth-child(2){animation-delay:.4s}
.mappy-skit-wink .mappy-body{animation:mappy-nod .6s ease-in-out 2}
.mappy-wink{animation:mappy-dot .5s ease-in-out 1}
@keyframes mappy-blush{0%,100%{transform:scale(1.25)}50%{transform:scale(1.6)}}
@keyframes mappy-wiggle{0%,100%{transform:none}25%{transform:rotate(-4deg) scale(1.03,.98)}60%{transform:rotate(3deg) translateY(-3px)}}
@keyframes mappy-squish{0%{transform:none}30%{transform:scale(1.18,.78)}60%{transform:scale(.92,1.1) translateY(-5px)}100%{transform:none}}
@keyframes mappy-boopheart{0%{opacity:0;transform:translateY(8px) scale(.4)}25%{opacity:1;transform:translateY(0) scale(1.5)}100%{opacity:0;transform:translateY(-14px) scale(1.1)}}
@keyframes mappy-dangle{0%,100%{transform:rotate(-9deg)}50%{transform:rotate(9deg)}}
@keyframes mappy-sway{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg) translateY(-2px)}}
@keyframes mappy-jitterhop{0%,100%{transform:translateY(0) scale(1)}35%{transform:translateY(-10px) scale(.95,1.06) rotate(-3deg)}65%{transform:translateY(0) scale(1.08,.93) rotate(3deg)}}
@keyframes mappy-heartup{0%{opacity:0;transform:translateY(6px) scale(.5)}20%{opacity:1;transform:translateY(0) scale(1.2)}100%{opacity:0;transform:translateY(-18px) scale(.9)}}
@keyframes mappy-confetti{0%{opacity:1;transform:translate(0,0) rotate(0)}70%{opacity:1}100%{opacity:0;transform:translate(var(--cx),calc(var(--cy) + 30px)) rotate(540deg)}}
@keyframes mappy-dance{0%,100%{transform:none}10%,30%,50%,70%{transform:rotate(-8deg) translateY(-4px)}20%,40%,60%,80%{transform:rotate(8deg) translateY(0)}90%{transform:translateY(-8px) scale(1.05,.95)}}
.mappy-mood-dance .mappy-body{animation:mappy-dance 3.6s ease-in-out both}
.mappy-mood-dance .mappy-hand{animation:mappy-wave .3s ease-in-out 12}
.mappy-mood-roll .mappy-body{animation:mappy-roll 1.1s cubic-bezier(.4,1.4,.5,1) 1 both}
.mappy-mood-dizzy .mappy-body{animation:mappy-wobble .5s ease-in-out 5}
.mappy-spiral path{transform-box:fill-box;transform-origin:center;animation:mappy-twirl .8s linear infinite}
.mappy-mood-party .mappy-body{animation:mappy-jitterhop .42s ease-in-out 12}
.mappy-mood-party .mappy-hand{animation:mappy-wave .21s ease-in-out 24}
.mappy-mood-party .mappy-confetti rect{animation-iteration-count:4}
.mappy-hat{transform-box:view-box;transform-origin:50px 14px}
.mappy-mood-party .mappy-hat{animation:mappy-wave .42s ease-in-out 12}
.mappy-held{transform-origin:88px 20px;transform-box:view-box}
.mappy-drift>*{transform-box:fill-box;transform-origin:center;animation:mappy-drift 3.6s ease-in-out infinite}
.mappy-drift>*:nth-child(2n){animation-duration:4.4s;animation-delay:-1.3s}
.mappy-drift>*:nth-child(3n){animation-duration:5.1s;animation-delay:-2.6s}
.mappy-drift>*:nth-child(4n+1){animation-delay:-.7s}
@keyframes mappy-drift{0%,100%{transform:translate(0,0) rotate(0)}33%{transform:translate(1.2px,-2.4px) rotate(6deg)}66%{transform:translate(-1px,-1px) rotate(-5deg)}}
.mappy-buddy{transform-box:fill-box;transform-origin:50% 100%;animation:mappy-buddy 2.8s ease-in-out infinite}
@keyframes mappy-buddy{0%,100%{transform:none}40%{transform:translateY(-1.5px) scale(1.03,.97)}60%{transform:translateY(0) scale(.98,1.02)}}
.mappy-hover .mappy-buddy{animation:mappy-hop .6s ease-in-out 2}
.mappy-mood-party .mappy-buddy,.mappy-mood-dance .mappy-buddy,.mappy-skit-dance .mappy-buddy{animation:mappy-jitterhop .42s ease-in-out 12}
.mappy-skit-shiver .mappy-body{animation:mappy-shiver .14s linear 14}
@keyframes mappy-shiver{0%,100%{transform:translateX(0)}25%{transform:translateX(-1.2px) rotate(-1deg)}75%{transform:translateX(1.2px) rotate(1deg)}}
.mappy-skit-fan .mappy-hand{animation:mappy-wave .22s ease-in-out 14;transform-origin:88px 20px}
.mappy-sweat{animation:mappy-sweat 1.2s ease-in 3}
@keyframes mappy-sweat{0%{opacity:0;transform:translateY(0)}20%{opacity:1}100%{opacity:0;transform:translateY(10px)}}
.mappy-skit-sneeze .mappy-body{animation:mappy-sneeze 1.6s ease-in-out 1}
@keyframes mappy-sneeze{0%,100%{transform:none}30%{transform:scale(1.04,1.08) translateY(-3px) rotate(-3deg)}45%{transform:scale(1.04,1.08) translateY(-4px) rotate(-4deg)}55%{transform:scale(1.06,.9) translateY(4px) rotate(6deg)}70%{transform:scale(.98,1.02)}}
.mappy-achoo{animation:mappy-achoo 1.6s ease-out 1}
@keyframes mappy-achoo{0%,50%{opacity:0;transform:scale(.4)}60%{opacity:1;transform:scale(1.15)}100%{opacity:0;transform:scale(1) translateX(10px)}}
.mappy-skit-hum .mappy-body{animation:mappy-sway 1.2s ease-in-out 3}
.mappy-skit-yawn .mappy-body{animation:mappy-stretch 2.4s ease-in-out 1}
.mappy-skit-lookaround .mappy-pupils{animation:mappy-lookaround 3.2s ease-in-out 1}
@keyframes mappy-lookaround{0%,100%{transform:translate(0,0)}20%,35%{transform:translate(-3px,-1px)}55%,70%{transform:translate(3px,-1px)}85%{transform:translate(0,2px)}}
@keyframes mappy-roll{0%{transform:translateY(0) rotate(0)}40%{transform:translateY(-16px) rotate(200deg)}80%{transform:translateY(-4px) rotate(360deg)}100%{transform:translateY(0) rotate(360deg)}}
@keyframes mappy-wobble{0%,100%{transform:rotate(0)}25%{transform:rotate(-7deg) translateX(-2px)}75%{transform:rotate(7deg) translateX(2px)}}
@keyframes mappy-twirl{to{transform:rotate(360deg)}}
.mappy-still *,.mappy-still{animation:none!important;transition:none!important}
@keyframes mappy-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
@keyframes mappy-shadow{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.9)}}
@keyframes mappy-blink{0%,93%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}97%{transform:scaleY(1)}}
@keyframes mappy-talk{0%,100%{transform:scale(1,1)}50%{transform:scale(1.03,.97)}}
@keyframes mappy-wave{0%,100%{transform:rotate(0)}50%{transform:rotate(-28deg)}}
@keyframes mappy-hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-9px)}70%{transform:translateY(0) scale(1.04,.96)}}
@keyframes mappy-nod{0%,100%{transform:rotate(0)}50%{transform:rotate(4deg) translateY(1px)}}
@keyframes mappy-spin{0%{transform:translateY(0) rotate(0)}40%{transform:translateY(-14px) rotate(-12deg)}70%{transform:translateY(-6px) rotate(10deg)}100%{transform:translateY(0) rotate(0)}}
@keyframes mappy-tilt{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(-8deg)}}
@keyframes mappy-lean{0%,100%{transform:rotate(-3deg) translateX(-1px)}50%{transform:rotate(-1deg)}}
@keyframes mappy-lunge{0%{transform:translateX(0)}60%{transform:translateX(var(--mappy-lunge,6px))}100%{transform:translateX(calc(var(--mappy-lunge,6px) / 2))}}
@keyframes mappy-dot{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes mappy-scan{0%,100%{transform:rotate(-4deg) translateX(-2px)}50%{transform:rotate(4deg) translateX(2px)}}
@keyframes mappy-shake{0%,100%{transform:rotate(0)}25%{transform:rotate(-6deg)}75%{transform:rotate(6deg)}}
@keyframes mappy-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.02,.97)}}
@keyframes mappy-float{0%{transform:translateY(2px);opacity:.3}50%{opacity:1}100%{transform:translateY(-4px);opacity:.3}}
@keyframes mappy-bounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-12px)}55%{transform:translateY(0)}75%{transform:translateY(-5px)}}
@keyframes mappy-twinkle{0%,100%{opacity:.3}50%{opacity:1}}
@keyframes mappy-unfold{0%{transform:scale(.1,.02) translateY(40px);opacity:0}60%{opacity:1}100%{transform:none;opacity:1}}
@keyframes mappy-fold{0%{transform:none;opacity:1}100%{transform:scale(.1,.02) translateY(40px);opacity:0}}
@keyframes mappy-pop{0%{opacity:0;transform:translateY(6px) scale(.97)}100%{opacity:1;transform:none}}
@keyframes mappy-pulse{0%{box-shadow:0 0 0 0 rgba(230,119,0,.85)}70%{box-shadow:0 0 0 14px rgba(230,119,0,0)}100%{box-shadow:0 0 0 0 rgba(230,119,0,0)}}
@keyframes mappy-bulb{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.mappy-pulse{animation:mappy-pulse .8s ease-out 3;outline:3px solid #e67700!important;outline-offset:2px;border-radius:6px}

.mappy-bulb{position:absolute;top:-6px;left:50%;transform:translateX(-50%);width:32px;height:32px;min-width:32px;border-radius:50%;border:2px solid #3a3a3a;background:#ffe066;color:#111;font-size:1.05rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.25);animation:mappy-bulb 1.4s ease-in-out infinite;padding:0}
.mappy-bulb:focus-visible{outline:2px solid #0b57d0;outline-offset:2px}

.mappy-bubble{position:fixed;display:flex;flex-direction:column;box-sizing:border-box;
  background:var(--mappy-bg);color:var(--mappy-fg);border:1px solid var(--mappy-border);border-radius:var(--mappy-radius,10px);
  box-shadow:0 8px 28px rgba(0,0,0,.25);font-size:.875rem;line-height:1.5;animation:mappy-pop .18s ease-out;font-family:inherit;letter-spacing:normal;word-spacing:normal;text-align:left}
.mappy-bot{position:relative}
.mappy-copy{position:absolute;top:-4px;right:-4px;width:26px;height:26px;min-width:26px;padding:0;border:1px solid var(--mappy-border);border-radius:6px;background:var(--mappy-bg);color:var(--mappy-fg);font-size:.8rem;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s}
.mappy-bot:hover .mappy-copy,.mappy-copy:focus-visible{opacity:1}
.mappy-copy:focus-visible{outline:2px solid var(--mappy-focus,#0b57d0);outline-offset:1px}
@media (hover:none){.mappy-copy{opacity:1}}
.mappy-mic{font-size:1rem}
.mappy-mic.on{background:#d83020;color:#fff;border-radius:50%;animation:mappy-pulse 1.2s ease-out infinite}
.mappy-addr{display:inline;padding:0 2px;border:0;border-bottom:1px dotted currentColor;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:2px}
.mappy-addr:hover{background:var(--mappy-user-bg,rgba(0,0,0,.06))}
.mappy-addr:focus-visible{outline:2px solid var(--mappy-focus,#0b57d0);outline-offset:1px}
.mappy-grip{position:absolute;width:24px;height:24px;padding:0;border:0;background:transparent;z-index:3;touch-action:none;opacity:.9;transition:opacity .15s}
.mappy-grip:hover,.mappy-grip:focus-visible{opacity:1}
.mappy-grip:focus-visible{outline:2px solid var(--mappy-focus,#0b57d0);outline-offset:1px;border-radius:3px}
.mappy-grip::before{content:'';position:absolute;inset:4px;background:linear-gradient(135deg,transparent 0 45%,var(--mappy-fg,#333) 45% 52%,transparent 52% 64%,var(--mappy-fg,#333) 64% 71%,transparent 71%)}
.mappy-grip-br{right:-12px;bottom:-12px;cursor:nwse-resize}
.mappy-grip-tl{left:-14px;top:-18px;cursor:nwse-resize}.mappy-grip-tl::before{transform:rotate(180deg)}
.mappy-grip-tr{right:-14px;top:-18px;cursor:nesw-resize}.mappy-grip-tr::before{transform:rotate(-90deg)}
.mappy-grip-bl{left:-12px;bottom:-12px;cursor:nesw-resize}.mappy-grip-bl::before{transform:rotate(90deg)}
.mappy-tail{position:absolute;width:16px;height:16px;background:var(--mappy-bg);transform:rotate(45deg);pointer-events:none}
.mappy-tail.mappy-tail-down{bottom:-9px;border-right:1px solid var(--mappy-border);border-bottom:1px solid var(--mappy-border)}
.mappy-tail.mappy-tail-up{top:-9px;border-left:1px solid var(--mappy-border);border-top:1px solid var(--mappy-border)}
.mappy-tail.mappy-tail-left{left:-9px;border-left:1px solid var(--mappy-border);border-bottom:1px solid var(--mappy-border)}
.mappy-tail.mappy-tail-right{right:-9px;border-right:1px solid var(--mappy-border);border-top:1px solid var(--mappy-border)}
.mappy-bubble.mappy-docked{position:fixed;inset:0;width:auto;max-height:none;height:100%;border:0;border-radius:0;box-shadow:none;animation:none}
.mappy-docked .mappy-head{padding:8px 8px 8px 10px;gap:6px}
.mappy-docked .mappy-head h2{font-size:1rem}
.mappy-docked .mappy-avatar{flex:0 0 auto;width:34px;height:37px;display:flex;align-items:flex-end;justify-content:center;overflow:visible}
.mappy-docked .mappy-sub{display:block;font-size:.75rem;font-weight:400;color:var(--mappy-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mappy-docked .mappy-titles{flex:1;min-width:0}
.mappy-docked .mappy-titles h2{margin:0}
.mappy-docked .mappy-toolbar{padding:6px 10px}
.mappy-docked .mappy-log{padding:12px 14px;font-size:.9375rem}
.mappy-docked .mappy-chips{padding:0 14px 8px}
.mappy-docked .mappy-form{padding:10px 12px 12px}
.mappy-docked .mappy-input{min-height:38px;font-size:.9375rem}
.mappy-docked .mappy-form .mappy-btn{min-height:38px;padding:3px 14px}
.mappy-head{display:flex;align-items:center;gap:4px;padding:6px 6px 6px 12px;border-bottom:1px solid var(--mappy-line);flex:0 0 auto}
.mappy-head h2{flex:1;font-size:.875rem;font-weight:700;margin:0;color:inherit;line-height:1.3}
.mappy-iconbtn{border:0;background:transparent;color:inherit;min-width:28px;min-height:28px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:1rem;line-height:1;padding:0 4px}
.mappy-iconbtn:hover{background:var(--mappy-hover)}
.mappy-bubble :focus-visible{outline:2px solid var(--mappy-focus);outline-offset:1px}
.mappy-log{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:10px 12px;display:flex;flex-direction:column;gap:10px;min-height:48px}
.mappy-msg{max-width:100%;overflow-wrap:anywhere}
.mappy-msg.mappy-user{align-self:flex-end;background:var(--mappy-user-bg);color:var(--mappy-user-fg);padding:4px 10px;border-radius:12px 12px 2px 12px;max-width:85%;border:1px solid var(--mappy-line)}
.mappy-msg p{margin:0 0 4px}
.mappy-msg a{color:var(--mappy-link);text-decoration:underline}
.mappy-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.mappy-btn{border:1px solid var(--mappy-border);background:var(--mappy-btn-bg);color:var(--mappy-btn-fg);border-radius:6px;padding:3px 10px;min-height:28px;font-size:.8125rem;cursor:pointer;font-family:inherit;line-height:1.3}
.mappy-btn:hover{background:var(--mappy-hover)}
.mappy-btn[disabled]{opacity:.6;cursor:default}
.mappy-list{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:1px}
.mappy-row{display:flex;align-items:flex-start;gap:6px;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:4px 6px;min-height:28px;border-radius:6px;cursor:pointer;font-size:.8125rem;font-family:inherit;line-height:1.35}
.mappy-row:hover{background:var(--mappy-hover)}
.mappy-row .mappy-glyph{flex:0 0 auto;width:1em;text-align:center}
.mappy-row .mappy-row-text{flex:1 1 auto;min-width:0}
.mappy-row small{display:block;color:var(--mappy-muted)}
.mappy-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px;flex:0 0 auto}
.mappy-chip{border:1px solid var(--mappy-chip-border);background:transparent;color:inherit;border-radius:999px;padding:2px 12px;min-height:28px;font-size:.8125rem;cursor:pointer;font-family:inherit}
.mappy-chip:hover{background:var(--mappy-hover)}
.mappy-chart{margin:6px 0 2px;font-size:.8rem}
.mappy-chart-title{font-weight:600;margin-bottom:4px;opacity:.85}
.mappy-bar-row{display:grid;grid-template-columns:minmax(60px,34%) 1fr auto;gap:6px;align-items:center;margin:2px 0}
.mappy-bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mappy-bar-track{display:block;height:12px;background:var(--mappy-hover);border-radius:6px;overflow:hidden}
.mappy-bar{display:block;height:100%;background:var(--mappy-accent,#1d6fb8);border-radius:6px;transition:width .4s ease-out}
.mappy-bar-value{font-variant-numeric:tabular-nums;opacity:.85}
@media (prefers-reduced-motion: reduce){.mappy-bar{transition:none}}
.mappy-hints{display:flex;flex-wrap:wrap;gap:4px;padding:0 10px 4px;flex:0 0 auto}
.mappy-hint{border:1px dashed var(--mappy-chip-border);background:transparent;color:inherit;border-radius:8px;padding:1px 8px;min-height:22px;font-size:.75rem;opacity:.85;cursor:pointer;font-family:inherit}
.mappy-hint:hover{background:var(--mappy-hover);opacity:1}
.mappy-hint:first-child::after{content:' ⇥';opacity:.6}
.mappy-form{display:flex;gap:6px;padding:8px 10px 10px;border-top:1px solid var(--mappy-line);flex:0 0 auto}
.mappy-input{flex:1;min-width:0;border:1px solid var(--mappy-border);border-radius:6px;padding:4px 8px;min-height:32px;font-size:.875rem;background:var(--mappy-input-bg);color:var(--mappy-input-fg);font-family:inherit}
.mappy-input::placeholder{color:var(--mappy-muted);opacity:1}
.mappy-typing{display:inline-flex;gap:3px}
.mappy-typing i{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.3;animation:mappy-dot 1s infinite}
.mappy-typing i:nth-child(2){animation-delay:.15s}.mappy-typing i:nth-child(3){animation-delay:.3s}
.mappy-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.mappy-panel-note{font-size:.75rem;padding:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mappy-menu{position:fixed;min-width:220px;max-width:calc(100vw - 16px);background:#fff;color:#111;border:1px solid #3a3a3a;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.25);padding:4px;margin:0;list-style:none;font-size:.875rem;z-index:2147483001}
.mappy-menu button{display:flex;width:100%;align-items:center;gap:8px;text-align:left;border:0;background:transparent;color:inherit;min-height:32px;padding:4px 10px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:inherit}
.mappy-menu button:hover,.mappy-menu button:focus-visible{background:#e8f0fe;outline:2px solid #0b57d0;outline-offset:-2px}
.mappy-menu [role="separator"]{height:1px;background:#767676;margin:4px 6px}
@media (prefers-reduced-motion: reduce){.mappy-char *,.mappy-bubble,.mappy-bubble *,.mappy-bulb,.mappy-pulse{animation:none!important;transition:none!important}}
@media (forced-colors: active){.mappy-bubble,.mappy-menu,.mappy-btn,.mappy-chip,.mappy-input{border:1px solid CanvasText}.mappy-tail{display:none}}
`

export function injectStyles (target: Document = document): void {
  try {
    if (target.getElementById('mappy-styles')) return
    const el = target.createElement('style')
    el.id = 'mappy-styles'
    el.textContent = CSS + ACT_CSS
    target.head.appendChild(el)
  } catch (e) { }
}

export interface BubbleColors { [cssVar: string]: string }

/** Classic yellow bubble. Every pair checked for WCAG AA (text 4.5:1, borders and focus 3:1). */
export const CLASSIC: BubbleColors = {
  '--mappy-bg': '#ffffe1',
  '--mappy-fg': '#111111',
  '--mappy-muted': '#555555',
  '--mappy-border': '#3a3a3a',
  '--mappy-line': '#767676',
  '--mappy-chip-border': '#6b6b6b',
  '--mappy-hover': 'rgba(0,0,0,.08)',
  '--mappy-accent': '#0b57d0',
  '--mappy-user-bg': '#fff3a6',
  '--mappy-user-fg': '#111111',
  '--mappy-btn-bg': '#ffffff',
  '--mappy-btn-fg': '#111111',
  '--mappy-input-bg': '#ffffff',
  '--mappy-input-fg': '#111111',
  '--mappy-link': '#0b4fb3',
  '--mappy-focus': '#0b57d0',
  '--mappy-radius': '10px'
}

// ------------------------------------------------------------------ contrast helpers

function rgb (c: string): [number, number, number] | null {
  const s = String(c || '').trim()
  let m = s.match(/^#([0-9a-f]{3})$/i)
  if (m) return [0, 1, 2].map(i => parseInt(m![1][i] + m![1][i], 16)) as any
  m = s.match(/^#([0-9a-f]{6})/i)
  if (m) return [0, 2, 4].map(i => parseInt(m![1].slice(i, i + 2), 16)) as any
  m = s.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return null
}

function lum (c: [number, number, number]): number {
  const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}

/** WCAG contrast ratio; 0 when a color cannot be read (CSS variables, color-mix). */
export function contrast (a: string, b: string): number {
  const x = rgb(a); const y = rgb(b)
  if (!x || !y) return 0
  const l1 = lum(x); const l2 = lum(y)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** Theme bubble colors, each one checked; any pair that fails falls back to a safe color. */
export function themeColors (t: { surface: string, text: string, textSecondary: string, divider: string, primary: string, radiusLg: string }): BubbleColors {
  const bg = rgb(t.surface) ? t.surface : '#ffffff'
  const dark = rgb(bg) ? lum(rgb(bg)!) < 0.4 : false
  const safeText = dark ? '#ffffff' : '#111111'
  const fg = contrast(t.text, bg) >= 4.5 ? t.text : safeText
  const muted = contrast(t.textSecondary, bg) >= 4.5 ? t.textSecondary : (dark ? '#d0d0d0' : '#555555')
  const line = contrast(t.divider, bg) >= 3 ? t.divider : (dark ? '#9a9a9a' : '#767676')
  const focus = contrast(t.primary, bg) >= 3 ? t.primary : (dark ? '#8ab4f8' : '#0b57d0')
  const link = contrast(t.primary, bg) >= 4.5 ? t.primary : (dark ? '#8ab4f8' : '#0b4fb3')
  return {
    '--mappy-bg': bg,
    '--mappy-fg': fg,
    '--mappy-muted': muted,
    '--mappy-border': line,
    '--mappy-line': line,
    '--mappy-chip-border': line,
    '--mappy-hover': dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.07)',
    '--mappy-accent': focus,
    '--mappy-user-bg': dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.05)',
    '--mappy-user-fg': fg,
    '--mappy-btn-bg': bg,
    '--mappy-btn-fg': fg,
    '--mappy-input-bg': bg,
    '--mappy-input-fg': fg,
    '--mappy-link': link,
    '--mappy-focus': focus,
    '--mappy-radius': t.radiusLg || '10px'
  }
}
