import pymysql
from pymysql import Error
import os

class Database:
    def __init__(self):
        self.connection = None
        try:
            self.connection = pymysql.connect(
                host=os.getenv("DB_HOST", "svc.sel3.cloudtype.app"),
                port=int(os.getenv("DB_PORT", 31788)),
                database=os.getenv("DB_NAME", "highway"),
                user=os.getenv("DB_USER", "root"),
                password=os.getenv("DB_PASSWORD", "1234"),
                charset="utf8mb4",
                cursorclass=pymysql.cursors.DictCursor
            )
            print("MariaDB에 성공적으로 연결되었습니다.")
        except Error as e:
            print(f"MariaDB 연결 중 오류 발생: {e}")

    # =========================
    # 휴게소 전체 조회
    # =========================
    def get_rest_areas(self, limit=None):
        """
        rest_areas 테이블에서 휴게소 목록 조회
        """
        if self.connection is None:
            print("데이터베이스 연결이 없습니다.")
            return []

        try:
            with self.connection.cursor() as cursor:
                query = """
                SELECT
                    id,
                    name,
                    route_no,
                    direction,
                    latitude AS lat,
                    longitude AS lng,
                    IFNULL(signature_food, '') AS food,
                    gas_ys AS gas,
                    elec_ys AS elec,
                    phar_ys AS pharmacy,
                    Nursing_ys AS nurse,
                    signature_food,
                    tel,
                    highway_name
                FROM highway
                """
                if limit:
                    query += " LIMIT %s"
                    cursor.execute(query, (limit,))
                else:
                    cursor.execute(query)

                return cursor.fetchall()

        except Error as e:
            print(f"휴게소 조회 중 오류 발생: {e}")
            return []

    # =========================
    # 노선별 휴게소 조회
    # =========================
    def get_rest_areas_by_route(self, route_no):
        if self.connection is None:
            return []

        try:
            with self.connection.cursor() as cursor:
                query = """
                SELECT
                    id, name, route_no, direction,
                    latitude AS lat, longitude AS lng
                FROM highway
                WHERE route_no = %s
                """
                cursor.execute(query, (route_no,))
                return cursor.fetchall()

        except Error as e:
            print(f"노선별 휴게소 조회 오류: {e}")
            return []

    # =========================
    # DB 연결 종료
    # =========================
    def close(self):
        if self.connection:
            self.connection.close()
            print("MariaDB 연결이 종료되었습니다.")
