-- grc_base.sql
-- Source: CK_A2166.V_GRC
-- Goods Receipt at SKU × store level for a date range.
-- Bind variables:
--   :from_date   DATE  e.g. DATE '2026-08-01'
--   :to_date     DATE  e.g. DATE '2026-08-12'
--   :season      VARCHAR2  e.g. 'SS27' (pass NULL for all)

SELECT
    SITECODE,
    STORE_NAME     AS STORE_ALIAS,
    ATTRIBUTE1,
    DIVISION,
    SECTION,
    DEPARTMENT,
    DISPLAY_TYPE,
    ARTICLE_NAME,
    MRP,
    CAT1,
    CAT2,
    CAT3,
    CAT4           AS SIZE,
    CAT5,
    DESC2          AS COLOR,
    SEASON,
    BARCODE,
    SUM(NVL(GRC_Q, 0))      AS GRC_Q,
    SUM(NVL(GRSAMT, 0))     AS GRC_GROSS_V,
    SUM(NVL(NETAMT, 0))     AS GRC_NET_V,
    MAX(LAST_IN_RATE)       AS LAST_IN_RATE
FROM CK_A2166.V_GRC
WHERE TRUNC(GRC_DATE) >= :from_date
  AND TRUNC(GRC_DATE) <= :to_date
  AND (:season IS NULL OR SEASON = :season)
GROUP BY
    SITECODE, STORE_NAME, ATTRIBUTE1, DIVISION, SECTION,
    DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, MRP,
    CAT1, CAT2, CAT3, CAT4, CAT5, DESC2, SEASON, BARCODE
