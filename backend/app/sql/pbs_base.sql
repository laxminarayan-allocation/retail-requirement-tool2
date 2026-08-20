-- pbs_base.sql
-- Source: CK_A2166.V_PBS_MC
-- PBS (Planogram Build Standard) targets by store × department.
-- Contains store-level projections (PROJ_1..6) and the PBS qty.

SELECT
    ATTRIBUTE1,
    DIVISION,
    SECTION,
    DEPARTMENT,
    INVITEM_UDFSTRING06  AS DISPLAY_TYPE_CODE,
    STORE                AS STORE_NAME,
    NVL(PROJ_1, 0)       AS PROJ_1,
    NVL(PROJ_2, 0)       AS PROJ_2,
    NVL(PROJ_3, 0)       AS PROJ_3,
    NVL(PROJ_4, 0)       AS PROJ_4,
    NVL(PROJ_5, 0)       AS PROJ_5,
    NVL(PROJ_6, 0)       AS PROJ_6,
    NVL(PBS,    0)       AS PBS,
    NVL(NEW_BGT_STR, 0)  AS NEW_BGT_STR
FROM CK_A2166.V_PBS_MC
