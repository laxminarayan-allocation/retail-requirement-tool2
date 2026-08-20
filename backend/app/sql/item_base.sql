-- item_base.sql
-- Source: CK_A2166.ITEM_MASTER
-- Full SKU universe — filtering is done in Python after fetch.
-- No bind variables — avoids Oracle 12.1 issues with optional IS NULL checks.

SELECT
    ICODE,
    BARCODE,
    ATTRIBUTE1,
    DIVISION,
    SECTION,
    DISPLAY_TYPE,
    DEPARTMENT,
    ARTICLE_NAME,
    MRP,
    SEASON,
    CAT1,
    CAT2,
    CAT3,
    CAT4          AS ITEM_SIZE,
    CAT5,
    CAT6,
    DESC1,
    DESC2         AS ITEM_COLOR,
    DESC3,
    DESC4,
    DESC5,
    DESC6,
    LAST_IN_RATE,
    STANDARD_RATE,
    STOCKINDATE
FROM CK_A2166.ITEM_MASTER
ORDER BY DIVISION, DEPARTMENT, ARTICLE_NAME, MRP
