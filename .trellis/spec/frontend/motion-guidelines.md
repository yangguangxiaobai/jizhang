# Motion Guidelines — Frontend

> How the interface moves, why each movement exists, and which movements are deliberately
> absent. The tokens live in `styles/main.css`; the applied poses live beside the components
> that own their geometry.

---

## Why there is a document for this

Motion is the one part of a UI that cannot be reviewed by reading it. A stylesheet full of
`transition: 0.3s ease` looks the same whether it produces a considered interface or a
fidgety one, and every defect in this file was found by measuring a rendered page rather
than by re-reading the CSS. So the rules below are written to be *checkable*: ten of them
are enforced by `scripts/check-motion.mjs` against source, and the rest by
`scripts/render-motion.mjs` against a real browser.

The vocabulary is the twelve classical principles of animation. They were written for drawn
characters, so the honest version of this document is a mapping that says plainly which ones
transfer to a ledger, which one transfers as a metaphor, and which are refused.

---

## The twelve, mapped

| # | Principle | Here it is | Where |
|---|---|---|---|
| 1 | Squash & stretch | A control compresses to 0.97 under the finger | `main.css` `:active`, `--press-scale` |
| 2 | Anticipation | The press squash *is* the wind-up; the selected glyph and label settle one stagger step later | `AppShell.vue` `.tab` |
| 3 | Staging | One thing moves at a time: blocks arrive in sequence, the outgoing view is cut | `main.css` `.view-slot > *` |
| 4 | Pose to pose | A closed set of named poses; no ad-hoc inline keyframes | `main.css`, `DonutChart`, `BarChart` |
| 5 | Follow through & overlapping action | Staggered arrivals; the tab label, the chart legend and the axis labels settle after what they annotate | `.reveal`, `--i`, `--stagger` |
| 6 | Slow in & slow out | Three easing tokens; `linear` appears nowhere | `main.css` |
| 7 | Arcs | Each donut slice rotates about the chart centre into place, in angular order | `DonutChart.vue` `arc-in` |
| 8 | Secondary action | The selected glyph pill and lift are secondary to the label | `AppShell.vue` `.glyph` |
| 9 | Timing | Durations follow *distance*, not importance | `--dur-*` ladder |
| 10 | Exaggeration | Rationed to two places: the error shake, and the overshoot on the one card that asks for a decision | `shake-x`, `pop-in` |
| 11 | Solid drawing | Two elevations, each a key shadow plus an ambient one | `--lift-1`, `--lift-2` |
| 12 | Appeal | One personality: two curves, one distance, one stagger step, everywhere | all of the above |

### The one that is a metaphor, not a mechanism

**Arcs** in drawn animation is a limb travelling on a curve. A ledger's elements move in a
straight line, and pretending otherwise would be dishonest decoration. The principle lands
where the geometry genuinely is curved: the donut, where each slice swings into place about
the chart's centre and the sequence of slices reads as a sweep around the circle.

### Durations follow distance

`--dur-press` 90ms · `--dur-quick` 140ms · `--dur-base` 220ms · `--dur-slow` 320ms.

A 2px nudge that lasted as long as a full-width slide reads as sluggish; a full-width slide
that matched the nudge reads as a glitch. The ladder is the rule, and it is enforced: every
`transition`/`animation` duration in the codebase must resolve to one of these tokens.

`--stagger` (36ms) is the gap between consecutive items, and it is **always capped at six
steps**. A sixty-row list on a 36ms stagger would take two seconds to finish appearing,
which is past the point where it reads as speed. `check-motion.mjs` fails a delay computed
from `--i` that is not clipped by `min()`.

### The elevations

`--lift-1` and `--lift-2`, each a *pair* of shadows (a tight key and a wide ambient one).
A single blur radius reads as a grey halo, not as an object above a surface. In dark mode
both are much darker and the surface/value contrast does most of the separating work — a
6%-alpha shadow is invisible against `#16181d`.

There is deliberately no rung for "pressed": the pressed state is the squash, and a shadow
that changes under a finger is invisible anyway because the finger is on top of it. There is
no rung above `--lift-2` because nothing in the app floats over the page — and
`check-motion.mjs` will fail a third rung added "for later", on the same principle that fails
an unused keyframe. Depth is a vocabulary of exactly two words, and both are in use:
`--lift-1` on the sticky header, balance card, and selected display-mode control; `--lift-2`
on the one card that asks for a decision. The theme refresh replaces the redundant active-tab
underline with a tinted glyph pill and stronger text. `render-motion.mjs` now measures that
pill's color, visible box, glyph transform, and text-weight cue rather than an absent `::after`.

---

## The four structural rules

These are what make the system maintainable, and each one exists because the alternative
has a specific failure mode.

### 1. A keyframe declares only a `from` frame

There is not one `to` frame in the codebase. The missing 100% keyframe is supplied by the
element's own computed style, so the resting state is the *rule* and the keyframe only
describes where the element came from.

This makes one whole class of bug impossible to write: an element whose base rule says
`opacity: 0` and which relies on an animation to become visible. If that animation is
suppressed — by `prefers-reduced-motion`, by a browser that does not support the property,
by a typo in the name — the element is invisible forever and nothing reports an error.
Enforced statically.

### 2. `animation-fill-mode: backwards`, never `both`

`backwards` paints the `from` pose during the stagger delay and then releases the element to
its own style. `both` keeps a fill frame applied permanently, holding a compositor layer for
every animated element on the page. Measured in the browser: every arrival reports
`backwards`.

### 3. Frame state is a token, so one media query turns everything off

Every duration is a `var(--dur-*)`. The entire reduced-motion implementation is therefore
this, and nothing else in the app has to know about it:

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-press: 1ms;
    --dur-quick: 1ms;
    --dur-base: 1ms;
    --dur-slow: 1ms;
    --stagger: 0ms;
  }
}
```

Collapsing the duration to a millisecond is not a compromise — it is the correct answer.
Vestibular discomfort comes from *motion over time*, and a 1ms change carries no travel
while still reaching the final state. `check-motion.mjs` fails the build if a new `--dur-*`
token is added and not reset in that block.

The press scale is deliberately kept. It is an instantaneous state change, it carries no
travel, and removing it would take away feedback that has nothing to do with motion.

**A blanket `* { animation: none !important }` is the common version of this and is worse**:
it is applied to elements that were relying on a keyframe for a visual state, and the
`!important` makes the resulting bug very hard to find from the stylesheet.

### 4. Only `opacity` and `transform` animate

`width`, `height`, `top`, `left`, `margin` and `padding` are layout properties: animating one
re-runs layout for the affected subtree on every frame. On a phone that is the difference
between a transition that costs nothing and one that drops frames.

This rule found a real defect. Both progress bars were drawn with `width: <n>%` and the
budget bar transitioned that width. They are now `transform: scaleX(var(--fill))` on a
full-width track that clips, which is the same picture drawn a cheaper way. The template
supplies a unit interval instead of a percentage string, so the view keeps its own
arithmetic and the stylesheet only interpolates.

Both progress bars also grow from zero on arrival (`fill-grow`), so the length reads as a
measurement rather than as a bar that was always that long.

---

## Where motion is refused

A principle applied everywhere stops meaning anything. These refusals are as much a part of
the design as the movements are.

**No count-up on money figures.** Animating a total from `0.00` upward is the obvious
"appeal" move and it is wrong here twice over: it displays numbers the server never
computed, and it makes the one figure the user came to read unreadable for as long as it
runs. Appeal is served instead by the donut's arc sweep, the growth of both progress bars
and the staged arrival — none of which ever puts a number on screen that the server did not
produce.

**No looping decoration.** No shimmer, no pulse, no floating illustration. A ledger should
be still when nothing is happening. It also costs battery on the device this is built for.

**No animated outgoing view.** View departure is an instant cut rather than a transition.
One thing moves at a time, and a tab bar that waits for the previous page to finish leaving
feels broken.

**No transition on a theme change.** Switching light/dark is a single attribute flip that
restyles every surface at once, and animating it properly would mean a `background-color`
and `color` transition on `body` *and* on every card, border, muted label and chart stroke —
which is a great deal of surface area to buy a half-second fade. Animating only the page
background is worse than not animating at all: the background would ease while every card
snapped. A theme change is also not a transition between two states of the same thing; it is
a change of palette, and an instant repaint is how the platform does it.

**No `linear`.** Constant speed is what a machine does.

**No transitions on the root of a route.** A `<Transition>` around `<RouterView>` would need
every view to have a single root element, and every view here renders a fragment; a
transition around a fragment silently does nothing. The arrival is expressed in CSS on a
route-keyed wrapper instead (see below), which also keeps the stagger on the view's real
top-level blocks rather than on one wrapper.

---

## How a screen gets motion

Nothing is opted into per view. `AppShell.vue` renders:

```html
<div :key="route.path" class="view-slot">
  <RouterView />
</div>
```

and `main.css` animates `.view-slot > *` with a delay ladder chosen by `:nth-child`. So
**every screen gets a staged arrival for free**, and a view that renders four blocks gets a
four-step reveal without containing a line of motion code.

The key on the route path is load-bearing twice: it makes the blocks new elements on every
navigation, so the animation always replays, and it prevents two records of the same view
(`/transactions/new` → `/transactions/:id/edit`) from reusing the DOM and leaving the
previous form's values on screen.

For an item inside a container, add `class="reveal"` and supply the index as `--i`:

```html
<li v-for="(module, index) in modules" :key="module.id" class="reveal" :style="{ '--i': index }">
```

The index comes from the template rather than from `:nth-child` because a chart's SVG shapes
are not in visual order once the geometry has positioned them.

### Component-local poses

A keyframe whose geometry belongs to one component is declared in that component's scoped
style, not in `main.css`: `arc-in` (the donut's centre), `grow-y` (the bar chart's baseline),
`fill-grow` (a progress bar's left edge). The shared file holds only poses that are about
the interface as a whole.

Both chart poses express their pivot by translating it to the origin and back
(`translate(var(--pivot), var(--pivot)) rotate(…) translate(calc(-1 * var(--pivot)), …)`)
rather than with `transform-origin`. An SVG element's transform origin defaults to the
corner of the viewBox and `transform-box` — the property that would redefine it — is
unevenly supported on the iOS versions this targets. The transform list is the same
rotation, written in a form every engine agrees about.

---

## Verification

| Script | Reads | Catches |
|---|---|---|
| `check-motion.mjs` (in `pnpm build`) | CSS source | `transition: all`; `linear`; literal durations; `to` frames; layout properties in a transition or a keyframe; a keyframe referenced but not defined, or defined but never used; a motion token nothing references; a `--dur-*` token missing from the reduced-motion block; an uncapped stagger |
| `render-motion.mjs` | A real browser | that any of it runs; the arrival order and its cap; the properties the engine actually built; press feedback; the indicator's drawn state; the donut arcs and the bar growth; and the whole reduced-motion path, exercised |

`check-motion.mjs` cannot see a computed value, and `render-motion.mjs` can only see the
pages it visits. A misspelled `animation-name` in a component that happens not to be on
screen is invisible to the browser suite and *is* caught by the static one, which is why
both exist.

### What the browser suite does that a screenshot cannot

- **It exercises the reduced-motion path.** `Emulation.setEmulatedMedia` switches the
  browser into `prefers-reduced-motion: reduce`, and the suite then asserts that the
  rendered text is *identical* to the normal run and that no laid-out element is left fully
  transparent. That is the contract's whole promise: motion is removed, content is not.
- **It counts stranded elements only after the arrival has settled.** A block sitting out
  its stagger delay is transparent on purpose; counting it would make the check fire on
  correct behaviour. This cost a debugging round.
- **It waits for the animation to start, not for the page to render.** `animationstart`
  fires *after* an animation's delay, so a staggered arrival is only fully recorded once the
  last block has begun. Reading the log as soon as the page rendered under-counted,
  intermittently, by exactly the number of blocks that had not started yet — 2 of 4 one run,
  4 of 4 the next.
- **It reads the animated properties from the engine** at `animationstart`, so "no layout
  property is animated" is a measured fact rather than a claim about the stylesheet's text.

`screenshot` is taken at the end of the run, and the suite takes its arguments in the same
order as its five siblings (`<out.png> [base-url]`). It did not, briefly, and a runner that
invoked all six suites uniformly therefore passed a Windows screenshot path to `fetch` as the
base URL — which surfaced as a bare `TypeError: fetch failed` several layers away from the
mistake. It now validates the base URL and prints its usage instead.

---

## Four traps, all found by measuring

### `DOM.getDocument` discards the node map

Two consecutive `DOM.getDocument` calls over an unchanged page returned different node ids
for the same element (101/115, then 151/165). Forcing `:active` on the first id and clearing
it on the second left the element **stuck at the pressed transform** — measured: it stayed
at `matrix(0.97, …)` for the next 500ms. `forcePseudoState` therefore returns a handle and
the caller releases through it, so the clear always names the id the force used.

### The Web Animations API reports CSS easing as `linear`

`animation.effect.getTiming().easing` is `linear` for *every* CSS animation; the real curve
lives on the keyframes. Reading it there would make a "no linear easing" assertion pass on
an app with nothing but linear easing. The suite records
`getComputedStyle(target).animationTimingFunction` at `animationstart` instead, which reports
`cubic-bezier(0.16, 1, 0.3, 1)` as expected.

### Vue renames scoped keyframes

A `@keyframes` inside `<style scoped>` is emitted as `grow-y-23111426`: the scope hash is
appended to the definition and to every `animation` reference. Global keyframes from
`main.css` keep their bare names. Assertions match by prefix; a suite comparing for equality
would report every component animation as missing.

### A backtick inside a template literal ends it

The browser driver builds injected page scripts as template literals. Writing `` `linear` ``
inside a comment in one of them terminated the string and produced a syntax error pointing at
the comment. Same family as the `*/` that closed a block comment early in `main.css` — when
editing a string that contains CSS or script, do not use its delimiters casually.
