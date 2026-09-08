-- store_base.sql
-- Source: CK_A2166.V_STORE_MASTER
-- Returns one row per active store with all dimension attributes.
-- Bind variables: none (full store universe)

SELECT
    SITECODE,
    LOCATION,
    SITEALIAS,
    STORE_NAME,
    STORE_NAME_F,
    ZONE,
    CITY,
    STATE_NAME,
    CLSTR          AS CLUSTER_TYPE,
    GRADE          AS STORE_GRADE,
    GM_GRD,
    STORE_TAG,
    STORE_STATUS,
    OPENING_DATE,
    STORE_TYPE,
    AREA,
    VM_FILTER,
    STORE_DESC_FILTER
FROM CK_A2166.V_STORE_MASTER
ORDER BY STORE_NAME
