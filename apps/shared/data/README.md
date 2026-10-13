# San Isidro East mapped boundary

`san-isidro-east.json` contains the unsimplified 78-vertex polygon for San Isidro
East, Malvar, Batangas (PSGC `0401017015`). It replaces the former hand-drawn
14-vertex approximation, including the omitted area on the San Gregorio-road side.

The feature was extracted from `phl_admbnda_adm4_psa_namria_20231106.shp`, with
`ADM4_PCODE=PH0401017015`, `ADM3_EN=Malvar` and `ADM2_EN=Batangas`. Its recorded
validity date is 6 November 2023. Coordinates are WGS84 longitude/latitude, with
the source precision retained. No boundary simplification or buffer was applied.

Attribution: National Mapping and Resource Information Authority (NAMRIA),
Philippine Statistics Authority (PSA), OCHA/HDX; dataset license
[CC BY-IGO](https://creativecommons.org/licenses/by/3.0/igo/).
Original dataset: [Philippines administrative boundaries](https://data.humdata.org/dataset/cod-ab-phl).
Archived 2023 source: [shapefile mirror](https://github.com/altcoder/philippines-psgc-shapefiles/tree/main/data/2023/BgySubMuns).
The current HDX release may differ from this archived version. This is a mapped
administrative boundary, not a cadastral survey or a certification of legal limits.

Both apps import `safeZone.js`; the SQL trigger uses the same ring. After a
boundary update in the full source workspace run `python scripts/sync_safe_zone.py`, test the incident rules,
and apply `supabase/migrations/20261013_san_isidro_boundary.sql` to the existing
database. Existing incident history is retained. Re-entry is evaluated on the
next valid, current GPS packet.
