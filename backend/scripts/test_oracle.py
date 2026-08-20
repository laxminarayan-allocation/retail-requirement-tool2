"""
Standalone Oracle connectivity test.
Run this before starting the server to verify credentials work.

    cd backend
    .\\venv\\Scripts\\Activate.ps1
    python scripts/test_oracle.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

from app.core.config import settings


def sep(title=""):
    print("\n" + "-" * 60)
    if title:
        print("  " + title)
    print()


def main():
    sep("Oracle Connectivity Test - Phase 2")

    if not settings.is_oracle_configured:
        print("ERROR: Oracle credentials not set in .env")
        sys.exit(1)

    thick_mode = settings.oracle_thick_mode
    lib_dir = settings.oracle_client_lib_dir

    print(f"  User    : {settings.oracle_user}")
    print(f"  DSN     : {settings.oracle_dsn}")
    print(f"  Mode    : {'thick' if thick_mode else 'thin'}")
    if thick_mode:
        print(f"  Lib dir : {lib_dir or '(auto-detect)'}")

    try:
        import oracledb
        print(f"  Driver  : oracledb {oracledb.__version__}")

        if thick_mode:
            # Verify lib dir exists before trying
            if lib_dir and not os.path.isdir(lib_dir):
                print()
                print(f"ERROR: ORACLE_CLIENT_LIB_DIR does not exist: {lib_dir}")
                print()
                print("Steps:")
                print("  1. Download Instant Client Basic ZIP from:")
                print("     https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html")
                print("  2. Extract the ZIP — you should get a folder like:")
                print("     instantclient_21_15  (containing oci.dll)")
                print("  3. Move/rename that folder to: C:\\oracle\\instantclient_21_15")
                print("  4. Re-run this script")
                sys.exit(1)

            oracledb.init_oracle_client(lib_dir=lib_dir or None)
            print("  Thick mode initialised OK")

        sep("Connecting...")
        t0 = time.perf_counter()
        with oracledb.connect(
            user=settings.oracle_user,
            password=settings.oracle_password,
            dsn=settings.oracle_dsn,
        ) as conn:
            elapsed = round((time.perf_counter() - t0) * 1000, 1)
            print(f"  Connected in {elapsed} ms")

            with conn.cursor() as cur:
                cur.execute("SELECT banner FROM v$version WHERE ROWNUM = 1")
                print(f"  Version : {cur.fetchone()[0]}")

                cur.execute("SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') FROM dual")
                schema = cur.fetchone()[0]
                print(f"  Schema  : {schema}")

                sep("Accessible schemas (top 20)")
                cur.execute(
                    "SELECT DISTINCT owner FROM all_objects "
                    "WHERE object_type IN ('TABLE','VIEW') "
                    "ORDER BY owner FETCH FIRST 20 ROWS ONLY"
                )
                for (owner,) in cur.fetchall():
                    print(f"    {owner}")

                sep(f"Sample tables in {schema} (top 15)")
                cur.execute(
                    "SELECT table_name, num_rows FROM all_tables "
                    "WHERE owner = :s ORDER BY table_name FETCH FIRST 15 ROWS ONLY",
                    [schema],
                )
                rows = cur.fetchall()
                if rows:
                    for name, nrows in rows:
                        print(f"    {name:<45}  rows~{nrows}")
                else:
                    print(f"    (no tables in schema {schema})")

        sep("Result")
        print("  OK - Oracle connection successful")
        print()

    except Exception as exc:
        err = str(exc)
        sep("FAILED")
        print(f"  {err}")
        print()

        if "DPY-3015" in err or "0x939" in err:
            print("  DPY-3015: Old 10g password verifier detected.")
            print("  The ALTER USER command needs to be run with SEC_CASE_SENSITIVE_LOGON=TRUE.")
            print()
            print("  Ask a DBA to run (as SYSDBA):")
            print("    ALTER SYSTEM SET sec_case_sensitive_logon = TRUE SCOPE=BOTH;")
            print(f"    ALTER USER {settings.oracle_user} IDENTIFIED BY <password>;")
            print()

        if "DPI-1047" in err:
            print("  DPI-1047: Instant Client not found.")
            print(f"  Expected at: {lib_dir}")
            print()
            print("  1. Download Instant Client Basic ZIP:")
            print("     https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html")
            print("  2. Extract so that oci.dll is at:")
            print(f"     {lib_dir}\\oci.dll")
            print()

        sys.exit(1)


if __name__ == "__main__":
    main()
