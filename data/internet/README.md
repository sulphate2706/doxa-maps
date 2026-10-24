# data/internet/ — internet use below the country level

Source files for `data/tables/internet-by-adm1.json`, which
`plugin-designs/cities-internet/scripts/build-adm1-internet.mjs` writes. Edit the sources here and
re-run the script; never edit the table by hand.

## nfhs5-internet-by-state.csv
- **What:** India, National Family Health Survey 5 (NFHS-5, 2019–21, IIPS / Ministry of Health and
  Family Welfare), indicators 18 and 19: *Women / Men (age 15–49) who have ever used the internet (%)*,
  by state/UT, urban / rural / total (plus the NFHS-4 total).
- **From:** the two internet rows of `NFHS-5-States.csv` in https://github.com/pratapvardhan/NFHS-5 at
  commit `93c67fed2403c8e533d178d293c5ba0411892b1e`, a CSV transcription of the official state fact sheets
  (http://rchiips.org/nfhs/). The transcriber notes that quality checks were minimal; the figures
  here were spot-checked against the national fact sheet (India: women 33.3%, men 57.1%).
- **Licence:** the CSV is **CC BY 4.0**. Attribution: "NFHS-5 (IIPS/MoHFW) state fact sheets, via
  pratapvardhan/NFHS-5 (CC BY 4.0)".
- **Measure:** a SURVEY SHARE OF PEOPLE (0–100%): has this person ever used the internet. It is
  not a subscription count (TRAI's "subscribers per 100" is a different measure and can exceed 100).

## adm1-crosswalk-IND.json
Source state names → the `shapeName` of `data/boundaries/gb-IND-ADM1-full.geojson` (all 36 states,
served as `assets/boundaries/gb-IND-ADM1-full.geojson`; source and licence in its `.meta.json`). Every source name must appear here, with either
the boundary name or `null` plus a reason. The build fails on anything else, never guesses.
