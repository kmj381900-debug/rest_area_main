import os
import requests
import json
from flask import Flask, render_template, request, jsonify
from db import Database

app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False

# =========================
# DB (MariaDB)
# =========================
db = Database()

# =========================
# Kakao REST API Key
# =========================
REST_API_KEY = os.getenv(
    "KAKAO_REST_API_KEY",
    "bc5e7a5770893ef473191d9d0e068aea"
)

# =========================
# 주소 / 장소 → 좌표 변환
# =========================
def geocode(query: str):
    headers = {"Authorization": f"KakaoAK {REST_API_KEY}"}

    # 주소 검색
    r = requests.get(
        "https://dapi.kakao.com/v2/local/search/address.json",
        headers=headers,
        params={"query": query},
        timeout=10
    ).json()

    if r.get("documents"):
        d = r["documents"][0]
        return float(d["x"]), float(d["y"])

    # 키워드 검색
    r = requests.get(
        "https://dapi.kakao.com/v2/local/search/keyword.json",
        headers=headers,
        params={"query": query},
        timeout=10
    ).json()

    if r.get("documents"):
        d = r["documents"][0]
        return float(d["x"]), float(d["y"])

    raise ValueError("주소를 좌표로 변환할 수 없습니다.")

# =========================
# 카카오 모빌리티 길찾기
# =========================
def get_route(origin, dest):
    url = "https://apis-navi.kakaomobility.com/v1/directions"
    headers = {"Authorization": f"KakaoAK {REST_API_KEY}"}
    params = {
        "origin": f"{origin[0]},{origin[1]}",
        "destination": f"{dest[0]},{dest[1]}",
        "priority": "RECOMMEND"
    }

    res = requests.get(url, headers=headers, params=params, timeout=15).json()

    routes = res.get("routes", [])
    if not routes:
        raise ValueError("길찾기 결과가 없습니다.")

    sections = routes[0].get("sections", [])
    if not sections:
        raise ValueError("길찾기 sections가 없습니다.")

    roads = sections[0].get("roads", [])
    coords = []

    for road in roads:
        v = road.get("vertexes", [])
        for i in range(0, len(v), 2):
            coords.append((v[i], v[i + 1]))

    return coords

# =========================
# 페이지
# =========================
@app.route("/")
def index():
    return render_template("index.html")

# =========================
# 경로 + 휴게소 조회
# =========================
@app.route("/route", methods=["POST"])
def route():
    data = request.get_json(force=True)
    start = data.get("start")
    end = data.get("end")

    try:
        start_xy = geocode(start)
        end_xy = geocode(end)
        route_points = get_route(start_xy, end_xy)

        # 🔥 MariaDB에서 휴게소 조회
        rests = db.get_rest_areas()

        return jsonify({
            "route": route_points,
            "rests": rests
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# =========================
# Gemini 휴게소 메뉴 설명
# =========================
@app.route("/get_info", methods=["POST"])
def get_rest_area_info():
    try:
        data = request.get_json()
        rest_name = data.get("name")

        api_key = "AIzaSyApV1p8LnK_38bPv9aM96MgTJu9FkJN2JA"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={api_key}"

        payload = {
            "contents": [{
                "parts": [{
                    "text": f"{rest_name} 해당 휴게소를 찾아서 실제로 판매중인 대표 메뉴 2개만 알려줘. 출력할 때 마크다운 쓰지말고 메뉴 밑에 간단한 설명으로 가독성 좋게 출력해. 내가 달라고 한 정보 말고 쓸데없는 말 하지마. 출력할때 bold 처리하지마라. 진짜 하지마라."
                }]
            }]
        }

        res = requests.post(url, json=payload, timeout=10).json()

        if "candidates" in res:
            text = res["candidates"][0]["content"]["parts"][0]["text"]
            return jsonify({"info": text})

        return jsonify({"error": "AI 응답 오류"}), 500

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host='0.0.0.0',debug=True)