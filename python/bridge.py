#!/usr/bin/env python3
import json, sys

def clean(text, limit=50000):
    return " ".join(str(text).split())[:limit]

def main():
    request=json.load(sys.stdin)
    backend=request.get("backend","scrapling")
    url=request["url"]
    selector=request.get("selector")
    if not url.startswith(("http://","https://")):
        raise ValueError("Only HTTP(S) URLs are allowed")
    if backend=="cloak":
        from cloakbrowser import launch
        browser=launch(headless=True)
        try:
            page=browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=int(request.get("timeout",45))*1000)
            result=page.locator(selector).all_text_contents() if selector else page.locator("body").inner_text()
        finally:
            browser.close()
    else:
        from scrapling.fetchers import Fetcher, StealthyFetcher
        fetcher=StealthyFetcher if request.get("stealth") else Fetcher
        page=fetcher.fetch(url) if hasattr(fetcher,"fetch") else fetcher.get(url)
        if selector:
            matches=page.css(selector)
            result=[getattr(item,"text",str(item)) for item in matches]
        else:
            result=getattr(page,"text",str(page))
    print(json.dumps({"ok":True,"backend":backend,"url":url,"content":clean(result)}))

if __name__=="__main__":
    try: main()
    except Exception as error:
        print(json.dumps({"ok":False,"error":str(error)}))
        sys.exit(1)
