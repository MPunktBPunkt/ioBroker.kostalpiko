#!/usr/bin/env python3
"""Remove legacy notify fields from kostalpiko instance native config."""
import json
import subprocess
import sys

LEGACY_KEYS = (
    'notifyAdapter',
    'notifyInstance',
    'notifyInstanceTelegram',
    'notifyInstancePushover',
)

for inst in ('0', '1'):
    oid = f'system.adapter.kostalpiko.{inst}'
    raw = subprocess.check_output(['iobroker', 'object', 'get', oid], text=True)
    obj = json.loads(raw)
    native = obj.get('native', {})
    changed = False
    for key in LEGACY_KEYS:
        if key in native:
            del native[key]
            changed = True
            print(f'{oid}: removed {key}')
    if not native.get('notifyInstanceEmail'):
        native['notifyInstanceEmail'] = 'email.0'
        changed = True
        print(f'{oid}: set notifyInstanceEmail=email.0')
    if changed:
        with open(f'/tmp/{oid.replace(".", "_")}_native.json', 'w', encoding='utf-8') as f:
            json.dump(native, f, ensure_ascii=False)
        subprocess.check_call([
            'iobroker', 'object', 'set', oid,
            f'native={json.dumps(native, ensure_ascii=False)}',
        ])
        print(f'{oid}: saved')
    else:
        print(f'{oid}: ok')

sys.exit(0)
