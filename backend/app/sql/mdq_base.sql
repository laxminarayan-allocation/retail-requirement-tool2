-- mdq_base.sql
-- Source: CK_A2166.V_MDQ_STR
-- MDQ (Minimum Display Quantity) and store capacity by store × department.
-- BGT_MC_STR is the final store budget qty after applying capacity constraints.

SELECT
    STORE_NAME,
    DIVISION,
    DEPARTMENT,
    ATTRIBUTE1,
    DISPLAY_TYPE,
    NVL(MDQ,           0) AS MDQ,
    NVL(MDQ_STR_ACTUAL,0) AS MDQ_STR_ACTUAL,
    NVL(MAX_CAP,       0) AS MAX_CAP,
    NVL(SAFETY_DAYS,   0) AS SAFETY_DAYS,
    NVL(NEW_BGT_STR,   0) AS NEW_BGT_STR,
    NVL(BGT_MC_STR,    0) AS BGT_MC_STR,
    NVL(LY_SL_Q,       0) AS LY_SL_Q,
    NVL(MONTH_1,       0) AS MONTH_1,
    NVL(MONTH_2,       0) AS MONTH_2,
    NVL(MONTH_3,       0) AS MONTH_3
FROM CK_A2166.V_MDQ_STR
