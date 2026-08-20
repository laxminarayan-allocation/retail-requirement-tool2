-- target_base.sql
-- Source: CK_A2166.V_AOP_TGT_ART  (AOP target at article level)
-- Returns target qty / value and YTD achievement.
-- Bind variables: none

SELECT
    STORE_NAME,
    DIVISION,
    DEPARTMENT,
    DISPLAY_TYPE,
    ARTICLE_NAME,
    NVL(TGT_Q,    0) AS TGT_Q,
    NVL(TGT_V,    0) AS TGT_V,
    NVL(SL_Q,     0) AS SL_Q,
    NVL(SL_VAL,   0) AS SL_VAL,
    NVL(SL_V,     0) AS SL_V,
    NVL(ACHV_PER, 0) AS ACHV_PER
FROM CK_A2166.V_AOP_TGT_ART
