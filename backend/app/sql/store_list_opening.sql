-- store_list_opening.sql
-- Source: CK_A2166.T_STORE_OPENING_DATE
-- Returns all stores (including non-ACTIVE ones like SBW)

SELECT DISTINCT
    STORE_NAME
FROM CK_A2166.T_STORE_OPENING_DATE
ORDER BY STORE_NAME
