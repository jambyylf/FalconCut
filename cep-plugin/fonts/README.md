# Қаріп: Montserrat

- Авторы: Julieta Ulanovsky және Montserrat Project Authors (https://github.com/JulietaUla/Montserrat)
- Лицензиясы: SIL Open Font License 1.1 — [OFL.txt](OFL.txt)
- Көзі: `google/fonts` репозиторийіндегі `ofl/montserrat/Montserrat[wght].ttf` (Version 9.000)

`Montserrat-Kazakh.woff2` — осы қаріптің кішірейтілген нұсқасы. Панель желіге шықпауы үшін ол жергілікті файл ретінде жүктеледі. Ішінде:

- салмақ осі `wght` 400–800 (Regular … ExtraBold);
- латын әріптері (U+0000–017F), толық кириллица, оның ішінде қазақ әріптері ә ғ қ ң ө ұ ү һ і және бас әріптері (U+0400–04FF), тыныс белгілері (U+2000–206F), теңге белгісі ₸ (U+20B8), бағыттамалар (U+2190–2193), минус (U+2212).

Қайта жасау үшін (Python, `pip install fonttools brotli`):

```bash
python -m fontTools.varLib.instancer "Montserrat[wght].ttf" wght=400:800 -o Montserrat-400-800.ttf
python -m fontTools.subset Montserrat-400-800.ttf \
  --unicodes="U+0000-017F,U+0400-04FF,U+2000-206F,U+20B8,U+2190-2193,U+2212" \
  --layout-features='*' --flavor=woff2 --output-file=Montserrat-Kazakh.woff2
```
