#!/usr/bin/env python3
"""Convert Fusion 360 .f3d files to STEP via the APS Model Derivative API.

Usage:
    APS_CLIENT_ID=xxx APS_CLIENT_SECRET=yyy python3 aps_f3d_to_step.py [files...]

With no arguments, converts every */*.f3d under the script's directory.
STEP files are written next to this script in ./step_output/.

Requires an APS app (https://aps.autodesk.com/ -> Applications -> Create) with
the Data Management and Model Derivative APIs enabled. Stdlib only.
"""

import base64
import glob
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://developer.api.autodesk.com"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "step_output")
POLL_INTERVAL = 10
POLL_TIMEOUT = 15 * 60


def request(method, url, token=None, body=None, headers=None, raw=False):
    h = dict(headers or {})
    if token:
        h["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        if isinstance(body, (dict, list)):
            data = json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
        else:
            data = body
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    resp = urllib.request.urlopen(req, timeout=120)
    payload = resp.read()
    if raw:
        return resp, payload
    return resp, json.loads(payload) if payload else {}


def get_token(client_id, client_secret):
    auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "scope": "bucket:create bucket:read data:read data:write data:create",
    }).encode()
    _, out = request("POST", f"{BASE}/authentication/v2/token", body=body, headers={
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    return out["access_token"]


def ensure_bucket(token, bucket):
    try:
        request("POST", f"{BASE}/oss/v2/buckets", token,
                {"bucketKey": bucket, "policyKey": "transient"})
        print(f"  created bucket {bucket}")
    except urllib.error.HTTPError as e:
        if e.code != 409:  # 409 = already exists
            raise
        print(f"  bucket {bucket} already exists")


def upload(token, bucket, object_key, path):
    quoted = urllib.parse.quote(object_key)
    _, s3 = request("GET",
        f"{BASE}/oss/v2/buckets/{bucket}/objects/{quoted}/signeds3upload?parts=1", token)
    with open(path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(s3["urls"][0], data=data, method="PUT")
    urllib.request.urlopen(req, timeout=300).read()
    _, done = request("POST",
        f"{BASE}/oss/v2/buckets/{bucket}/objects/{quoted}/signeds3upload", token,
        {"uploadKey": s3["uploadKey"]})
    return done["objectId"]  # urn:adsk.objects:os.object:bucket/key


def to_urn(object_id):
    return base64.urlsafe_b64encode(object_id.encode()).decode().rstrip("=")


def submit_job(token, urn):
    body = {
        "input": {"urn": urn},
        "output": {"formats": [{"type": "step"}]},
    }
    request("POST", f"{BASE}/modelderivative/v2/designdata/job", token, body,
            headers={"x-ads-force": "true"})


def get_manifest(token, urn):
    _, m = request("GET", f"{BASE}/modelderivative/v2/designdata/{urn}/manifest", token)
    return m


def find_step_derivative(manifest):
    for d in manifest.get("derivatives", []):
        if d.get("outputType") == "step":
            if d.get("status") != "success":
                raise RuntimeError(f"step derivative status: {d.get('status')} "
                                   f"{json.dumps(d.get('messages', ''))[:500]}")
            for child in d.get("children", []):
                u = child.get("urn", "")
                if u.lower().endswith((".stp", ".step")):
                    return u
    return None


def download_derivative(token, urn, derivative_urn, dest):
    quoted = urllib.parse.quote(derivative_urn, safe="")
    url = f"{BASE}/modelderivative/v2/designdata/{urn}/manifest/{quoted}/signedcookies"
    resp, out = request("GET", url, token)
    cookies = "; ".join(c.split(";")[0] for c in resp.headers.get_all("Set-Cookie") or [])
    req = urllib.request.Request(out["url"], headers={"Cookie": cookies})
    data = urllib.request.urlopen(req, timeout=300).read()
    with open(dest, "wb") as f:
        f.write(data)
    return len(data)


def main():
    client_id = os.environ.get("APS_CLIENT_ID")
    client_secret = os.environ.get("APS_CLIENT_SECRET")
    if not client_id or not client_secret:
        sys.exit("Set APS_CLIENT_ID and APS_CLIENT_SECRET (create an app at "
                 "https://aps.autodesk.com/ with Data Management + Model Derivative APIs)")

    files = sys.argv[1:] or sorted(glob.glob(os.path.join(SCRIPT_DIR, "*", "*.f3d")))
    if not files:
        sys.exit("No .f3d files found")
    os.makedirs(OUT_DIR, exist_ok=True)

    print("Authenticating...")
    token = get_token(client_id, client_secret)
    bucket = "f3d2step-" + hashlib.sha1(client_id.encode()).hexdigest()[:12]
    ensure_bucket(token, bucket)

    jobs = {}  # urn -> (source path, output path)
    for path in files:
        name = os.path.splitext(os.path.basename(path))[0]
        object_key = name.replace(" ", "_") + ".f3d"
        print(f"Uploading {os.path.basename(path)} ...")
        object_id = upload(token, bucket, object_key, path)
        urn = to_urn(object_id)
        print("  submitting STEP translation job")
        submit_job(token, urn)
        jobs[urn] = (path, os.path.join(OUT_DIR, name + ".step"))

    pending = dict(jobs)
    deadline = time.time() + POLL_TIMEOUT
    while pending and time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        for urn in list(pending):
            src, dest = pending[urn]
            manifest = get_manifest(token, urn)
            status, progress = manifest.get("status"), manifest.get("progress")
            name = os.path.basename(src)
            if status == "success":
                deriv = find_step_derivative(manifest)
                if not deriv:
                    print(f"  {name}: manifest success but no STEP child found:")
                    print(json.dumps(manifest, indent=2)[:2000])
                    del pending[urn]
                    continue
                size = download_derivative(token, urn, deriv, dest)
                print(f"  {name}: DONE -> {dest} ({size:,} bytes)")
                del pending[urn]
            elif status in ("failed", "timeout"):
                print(f"  {name}: FAILED")
                print(json.dumps(manifest.get("derivatives", []), indent=2)[:2000])
                del pending[urn]
            else:
                print(f"  {name}: {status} ({progress})")
    if pending:
        print(f"Timed out waiting for: "
              f"{', '.join(os.path.basename(s) for s, _ in pending.values())}")
        sys.exit(1)


if __name__ == "__main__":
    main()
