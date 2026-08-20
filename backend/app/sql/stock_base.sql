-- stock_base.sql
-- Source: CK_A2166.V_ST_STK_MC  (MC / department level store stock)
-- Returns current stock position by store × department.
-- Bind variables: none

SELECT
    STORE_NAME,
    DEPARTMENT,
    DISPLAY_TYPE,
    NVL(STK_Q,      0) AS STK_Q,
    NVL(INTR_Q,     0) AS INTR_Q,
    NVL(PRD_Q,      0) AS PRD_Q,
    NVL(TO_Q,       0) AS TO_Q,
    NVL(ADJ_STK_Q,  0) AS ADJ_STK_Q,
    NVL(ADJ_INTR_Q, 0) AS ADJ_INTR_Q,
    NVL(ADJ_PRD_Q,  0) AS ADJ_PRD_Q,
    NVL(ADJ_TO_Q,   0) AS ADJ_TO_Q,
    NVL(LM_SL_Q,    0) AS LM_SL_Q,
    NVL(MTD_SL_Q,   0) AS MTD_SL_Q
FROM CK_A2166.V_ST_STK_MC
