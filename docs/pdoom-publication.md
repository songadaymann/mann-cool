# p(DOOM) publication

Canonical URL: https://mann.cool/pdoom/
Source: https://github.com/songadaymann/pdoom
Delivery: dedicated `mann-cool-pdoom` Worker, existing shared platform APIs.

The cover follows the catalog cartridge format, inspired by the existing red bunker banner and title heroes. The five-second hover preview comes from the matching trailer's final 30 seconds. Desktop support is advertised; physical mobile compatibility is not claimed because the engine requires WebAssembly JSPI.

Open-source check: added missing MIT license and package metadata. The checker also flags historical `.env` in commit `123abcd`; inspected safely: it contains only `VITE_WALLET_CONNECT_PROJECT_ID`, a public client identifier, not a credential. No secret requires rotation and history is preserved.
