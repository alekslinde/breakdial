# breakdial

One dial (`0`–`10`) that breaks anything — from UI jank to backend outage.

```ts
import { dial } from '@breakdial/core'
dial(6) // 0=off, 1-2=paper-cuts, 3-4=jank, 5-7=outage, 8-10=catastrophe
```

Full package map: `../docs/breakdial/ORG-BREAKDOWN.md` (local docs folder).

## Scaffold

```
packages/core     @breakdial/core     dial engine, seeded RNG, scenarios (zero-dep)
packages/fetch    @breakdial/fetch    wrapFetch(): latency / 500 / timeout / offline
packages/react    @breakdial/react    <BreakDial/> slider + useBreak()
packages/express  @breakdial/express  breaker() middleware: delay / 500 per level
packages/mcp      @breakdial/mcp      breakdial_set / fire / list / verify (agent remote)
```

## Run

```bash
npm install
npm test   # build + smoke
```
