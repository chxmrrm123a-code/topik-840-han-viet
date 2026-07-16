# /// script
# dependencies = [
#   "playwright",
# ]
# ///

import os
import re
import sys
import time
from playwright.sync_api import sync_playwright

def main():
    print("=" * 60)
    print(" Supabase 자동 연동 및 설정 스크립트")
    print("=" * 60)
    print("설명:")
    print("1. 브라우저가 열리면 Supabase 로그인(이메일 또는 구글 로그인)을 해주세요.")
    print("2. 로그인이 완료되면 단어장용으로 만든 '프로젝트'를 클릭해 주세요.")
    print("3. 이후 프로그램이 API 키를 자동으로 추출하여 적용하고 배포까지 완료합니다.")
    print("=" * 60)
    
    with sync_playwright() as p:
        # Chromium 브라우저 실행 (헤드풀 모드)
        print("\n브라우저를 실행하는 중...")
        try:
            # 시스템에 설치된 Chrome 또는 Edge를 사용해 띄움
            browser = p.chromium.launch(headless=False, channel="chrome")
        except Exception:
            try:
                browser = p.chromium.launch(headless=False, channel="msedge")
            except Exception:
                print("시스템 크롬/엣지를 찾을 수 없어 기본 Chromium 브라우저를 다운로드/실행합니다.")
                browser = p.chromium.launch(headless=False)
                
        page = browser.new_page()
        page.goto("https://supabase.com/dashboard/sign-in")
        
        print("\n[대기 중] Supabase 로그인 및 프로젝트 선택을 완료해 주세요...")
        
        project_ref = None
        project_url = ""
        
        # 사용자가 로그인하고 프로젝트로 진입할 때까지 감시
        while True:
            try:
                current_url = page.url
                if "/dashboard/project/" in current_url:
                    # 프로젝트 메인 또는 하위 페이지 진입 감지
                    match = re.search(r"/dashboard/project/([a-zA-Z0-9]+)", current_url)
                    if match:
                        project_ref = match.group(1)
                        project_url = current_url
                        break
                time.sleep(1.5)
            except Exception as e:
                # 브라우저가 닫히거나 에러가 난 경우 탈출
                print("브라우저 감지 중 오류 또는 종료:", e)
                break
                
        if not project_ref:
            print("\n프로젝트 정보를 감지하지 못했습니다. 브라우저가 조기에 종료되었거나 페이지 이동이 없었습니다.")
            browser.close()
            return
            
        print(f"\n[성공] 프로젝트(ID: {project_ref}) 감지 완료!")
        
        # API 설정 페이지로 이동
        api_settings_url = f"https://supabase.com/dashboard/project/{project_ref}/settings/api"
        print("API 설정 페이지로 이동 중...")
        page.goto(api_settings_url)
        
        # 입력 필드가 로드될 때까지 최대 15초 대기
        page.wait_for_selector("input[readonly]", timeout=15000)
        time.sleep(2)  # 렌더링 대기
        
        inputs = page.query_selector_all("input[readonly]")
        url_val = None
        anon_key_val = None
        
        for inp in inputs:
            try:
                val = inp.input_value()
                if val.startswith("https://") and ".supabase.co" in val:
                    url_val = val
                elif val.startswith("eyJ") and len(val) > 100:
                    anon_key_val = val
            except Exception:
                continue
                
        if not url_val or not anon_key_val:
            print("데이터 로딩을 위해 잠시 더 대기합니다...")
            time.sleep(3)
            inputs = page.query_selector_all("input[readonly]")
            for inp in inputs:
                try:
                    val = inp.input_value()
                    if val.startswith("https://") and ".supabase.co" in val:
                        url_val = val
                    elif val.startswith("eyJ") and len(val) > 100:
                        anon_key_val = val
                except Exception:
                    continue
                    
        if url_val and anon_key_val:
            print("\n" + "-" * 50)
            print(f"추출 성공!")
            print(f"- Project URL: {url_val}")
            print(f"- Anon Key: {anon_key_val[:25]}...")
            print("-" * 50)
            
            # config.js 파일 생성/덮어쓰기
            config_path = "vietnamese-vocab/config.js"
            config_content = f"""// Supabase 설정 파일
const SUPABASE_CONFIG = {{
  url: "{url_val}",
  anonKey: "{anon_key_val}"
}};
"""
            with open(config_path, "w", encoding="utf-8") as f:
                f.write(config_content)
                
            print(f"\n[저장 완료] {config_path} 파일에 API 설정을 기록했습니다.")
        else:
            print("\n[오류] API URL 또는 Anon Key 추출에 실패했습니다. 페이지 구성을 확인해 주세요.")
            
        print("\n브라우저를 종료합니다.")
        browser.close()

if __name__ == "__main__":
    main()
