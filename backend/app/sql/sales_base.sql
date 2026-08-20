-- sales_base.sql
-- Source: CK_A2166.V_LAST_4WK_SL_ST_MC  (MC = department level)
--         CK_A2166.V_LAST_4WK_SL_ST_ART (article level)
-- Returns last-5-week rolling sales by store × department.
-- Bind variables: none (full universe; filter in Python)

-- MC (department) level — used for PBS / requirement calculation
SELECT
    STORE_NAME,
    DEPARTMENT,
    DISPLAY_TYPE,
    NVL(WK1, 0) AS WK1,
    NVL(WK2, 0) AS WK2,
    NVL(WK3, 0) AS WK3,
    NVL(WK4, 0) AS WK4,
    NVL(WK5, 0) AS WK5,
    NVL(MAX_SLQ, 0)   AS MAX_SLQ,
    MAX_WEEK,
    MAX_WEEK_START_DATE,
    MAX_WEEK_END_DATE
FROM CK_A2166.V_LAST_4WK_SL_ST_MC
