#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================
# 修仙・问道 — Python 后端（仅标准库）
# 启动: python server.py  → 浏览器打开 http://localhost:3456
#
# 依赖游戏核心模块（与本文件同级，或位于 server/ 子目录）:
#   state.py  → class GameState:
#       new_game(char_data)        开新档
#       save(slot) / load(slot)    存档 / 读档（load 返回 bool）
#       to_dict()                  状态快照（HUD 数据）
#       export_data() / upgrade()  存档格式导出 / 旧档升级（导入用）
#       data                       原始状态 dict（至少含 scene 字段）
#       saves_dir / config         存档目录 / 配置（maxSaveSlots）
#   engine.py → class GameEngine(state):
#       goto(scene_id, skip_enter) 跳转场景
#       choose(choice)             执行选项
#       current_scene()            当前场景快照（title/text/choices）
#       battle_snapshot()          战斗快照（无战斗时为 None）
# 命名有出入时按候选名自动探测（见「游戏核心适配层」）。
# ============================================
import json
import os
import socket
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urlsplit

PORT = 3456
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLIENT_DIR = os.path.join(BASE_DIR, 'client')

MIME = {
    '.html': 'text/html;charset=utf-8',
    '.css': 'text/css;charset=utf-8',
    '.js': 'application/javascript;charset=utf-8',
    '.json': 'application/json;charset=utf-8',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
}
TEXT_EXTS = ('.html', '.css', '.js', '.json')
NO_CACHE = 'no-cache, no-store, must-revalidate'

# 控制台输出统一 UTF-8（与 Node 版一致；避免重定向/Git Bash 下中文乱码）
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# ========== 加载游戏核心 ==========
# 兼容两种布局: state.py/engine.py 与 server.py 同级，或位于 server/ 子目录
sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
sys.path.insert(0, BASE_DIR)

try:
    from state import GameState
    from engine import GameEngine
except ImportError as e:
    print('[修仙问道] 游戏核心加载失败: %s' % e)
    print('[修仙问道] 请确认 state.py / engine.py 位于:')
    print('           %s' % BASE_DIR)
    print('       或  %s' % os.path.join(BASE_DIR, 'server'))
    sys.exit(1)

# 全局单例（配合 GAME_LOCK 串行访问，行为等同 Node 单线程模型）
try:
    state = GameState()
    engine = GameEngine(state)
except Exception as e:
    traceback.print_exc()
    print('[修仙问道] 游戏核心初始化失败: %s' % e)
    sys.exit(1)

GAME_LOCK = threading.Lock()
print('[修仙问道] 游戏核心加载完成')


# ========== 游戏核心适配层 ==========
def now_ms():
    """毫秒时间戳（与 JS Date.now() 对齐，保证存档时间可比）"""
    return int(time.time() * 1000)


def _call(obj, names, *args, **kw):
    """依次尝试 obj 上第一个存在的方法（兼容并行开发中的命名差异）"""
    for name in names:
        fn = getattr(obj, name, None)
        if callable(fn):
            return fn(*args)
    if kw.get('required'):
        raise AttributeError('%s 缺少方法: %s' % (type(obj).__name__, ' / '.join(names)))
    return kw.get('default')


def scene_id():
    """当前场景 ID（state.data 可能是 dict 或对象）"""
    data = getattr(state, 'data', None)
    if isinstance(data, dict):
        return data.get('scene')
    return getattr(data, 'scene', None)


def goto_scene(sid, silent=False):
    """engine.goto(scene_id, silent)；实现只收单参时自动退化"""
    try:
        engine.goto(sid, silent)
    except TypeError:
        engine.goto(sid)


def current_scene():
    scene = _call(engine, ('current_scene', 'get_scene', 'scene_snapshot'))
    if scene is None:
        scene = {'title': '未知', 'text': '场景数据丢失', 'choices': [], 'sceneId': scene_id()}
    return scene


def state_snapshot():
    snap = _call(state, ('snapshot', 'state_snapshot', 'to_dict'))
    if snap is None:
        data = getattr(state, 'data', None)
        snap = data if isinstance(data, dict) else {}
    return snap


def battle_snapshot():
    return _call(engine, ('battle_snapshot', 'get_battle'), default=None)


def _read_save_record(slot):
    """按 saves/slot_<slot>.json 约定读取存档记录（优先走 state 的路径方法）"""
    path_fn = getattr(state, '_slot_path', None)
    if callable(path_fn):
        path = path_fn(slot)
    else:
        saves_dir = getattr(state, 'saves_dir', os.path.join(BASE_DIR, 'saves'))
        path = os.path.join(saves_dir, 'slot_%s.json' % slot)
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _max_save_slots():
    cfg = getattr(state, 'config', None)
    if isinstance(cfg, dict):
        return int(cfg.get('maxSaveSlots') or 3)
    return 3


def saves_list():
    """归一化为前端所需格式: {slot,name,realm,scene,time} 或 {slot,empty:true}"""
    raw = _call(state, ('list_saves', 'save_list'))
    if raw is None:  # GameState 未提供列表方法 → 直接按存档文件约定读取
        raw = [{'slot': i, 'data': _read_save_record(i)}
               for i in range(1, _max_save_slots() + 1)]
    out = []
    for item in raw:
        if isinstance(item, dict) and 'data' in item:  # JS 风格 {slot, data}
            slot, data = item.get('slot'), item.get('data')
            if not data:
                out.append({'slot': slot, 'empty': True})
            else:
                meta = (data.get('meta') or {}) if isinstance(data, dict) else {}
                out.append({
                    'slot': slot,
                    'name': meta.get('name'),
                    'realm': meta.get('realm'),
                    'scene': meta.get('sceneTitle') or meta.get('scene'),
                    'time': meta.get('time'),
                })
        else:  # 已是扁平条目
            out.append(item)
    return out


def export_record():
    """完整导出记录 {version, exportedAt, state}（对齐 server.js /api/export）"""
    rec = _call(state, ('export_record',))
    if rec is None:
        st = _call(state, ('export_data',))  # GameState.export_data() 仅返回 state 部分
        if st is None:
            st = getattr(state, 'data', None) or {}
        rec = {
            'version': getattr(state, 'SAVE_VERSION', getattr(state, 'version', 1)),
            'exportedAt': now_ms(),
            'state': st,
        }
    return rec


def import_state(st):
    fn = None
    for name in ('import_data', 'import_state', 'import_save'):
        f = getattr(state, name, None)
        if callable(f):
            fn = f
            break
    if fn:
        fn(st)
    else:
        up = getattr(state, 'upgrade', None)
        state.data = up(st) if callable(up) else st


class ApiError(Exception):
    """带 HTTP 状态码的业务错误"""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


# ========== HTTP 服务 ==========
class GameHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    # ---- 基础输出 ----
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _send(self, code, body, ctype, extra=None):
        try:
            self.send_response(code)
            self._cors()
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', NO_CACHE)
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionError, BrokenPipeError, OSError):
            pass  # 客户端提前断开，忽略

    def _json(self, code, obj, extra=None):
        body = json.dumps(obj, ensure_ascii=False, default=str).encode('utf-8')
        self._send(code, body, 'application/json;charset=utf-8', extra)

    def _text(self, code, text):
        self._send(code, text.encode('utf-8'), 'text/plain;charset=utf-8')

    # ---- 请求体解析 ----
    def _body_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length > 0 else b''
        if not raw:
            return {}
        return json.loads(raw.decode('utf-8'))

    # ---- 路由 ----
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/ping':
            return self._json(200, {'pong': True, 'time': now_ms()})
        if path == '/api/saves':
            return self._api(self._api_saves)
        if path == '/api/export':
            return self._api(self._api_export)
        if path == '/api/create-data':
            return self._api(self._api_create_data)
        if path == '/api/all-sects':
            return self._api(self._api_all_sects)
        return self._static(path)

    def do_POST(self):
        path = urlsplit(self.path).path
        handler = {
            '/api/new-game': self._api_new_game,
            '/api/action': self._api_action,
            '/api/item': self._api_item,
            '/api/save': self._api_save,
            '/api/load': self._api_load,
            '/api/import': self._api_import,
        }.get(path)
        if handler is None:
            return self._text(404, 'Not Found')
        return self._api(handler)

    def _api(self, fn):
        """统一错误处理 + 全局锁（游戏核心非线程安全）"""
        try:
            with GAME_LOCK:
                fn()
        except ApiError as e:
            self._json(e.code, {'ok': False, 'error': str(e)})
        except Exception as e:
            traceback.print_exc()
            self._json(400, {'ok': False, 'error': str(e)})

    # ---- API 实现 ----
    def _api_new_game(self):
        char_data = self._body_json()
        state.new_game(char_data)
        goto_scene(scene_id())
        self._json(200, {'ok': True, 'scene': current_scene(), 'state': state_snapshot()})

    def _api_action(self):
        choice = self._body_json()
        engine.choose(choice)
        self._json(200, {
            'ok': True,
            'scene': current_scene(),
            'state': state_snapshot(),
            'battle': battle_snapshot(),
        })

    def _api_item(self):
        """背包/装备/法器操作:
        {op: use|equip|unequip|drop|faqi_put|faqi_take|faqi_deploy|faqi_undeploy, id?, slot?}"""
        body = self._body_json()
        op = body.get('op')
        iid = body.get('id')
        msg = ''
        if op == 'use':
            ok, msg = engine.use_item(iid)
            if not ok:
                raise ApiError(400, msg)
        elif op == 'equip':
            if not state.equip(iid):
                raise ApiError(400, '无法装备该物品')
            msg = '已装备'
        elif op == 'unequip':
            state.unequip(body.get('slot'))
            msg = '已卸下'
        elif op == 'drop':
            if not state.has_item(iid):
                raise ApiError(400, '物品不存在')
            state.remove_item(iid)
            msg = '已丢弃'
        elif op == 'faqi_put':
            if not state.faqi_put(iid):
                raise ApiError(400, '无法放入阵列（非法器或阵列已满）')
            msg = '已放入法器阵列'
        elif op == 'faqi_take':
            if not state.faqi_take(iid):
                raise ApiError(400, '阵列中没有该法器')
            msg = '已收回背包'
        elif op == 'faqi_deploy':
            if not state.faqi_deploy(iid):
                raise ApiError(400, '无法上阵（不在阵列或上阵已满）')
            msg = '已上阵'
        elif op == 'faqi_undeploy':
            if not state.faqi_undeploy(iid):
                raise ApiError(400, '该法器未上阵')
            msg = '已下阵'
        elif op == 'gongfa_equip':
            slot_idx = body.get('slot') if body.get('slot') is not None else 0
            if not state.equip_gongfa(iid, int(slot_idx)):
                raise ApiError(400, '无法装备该功法（未习得或槽位无效）')
            msg = '已装备功法'
        elif op == 'gongfa_unequip':
            kind = body.get('kind')
            slot_idx = body.get('slot') if body.get('slot') is not None else 0
            if not state.unequip_gongfa(kind, int(slot_idx)):
                raise ApiError(400, '卸下功法失败')
            msg = '已卸下功法'
        else:
            raise ApiError(400, '未知操作: %s' % op)
        self._json(200, {'ok': True, 'message': msg, 'state': state_snapshot()})

    def _api_save(self):
        body = self._body_json()
        state.save(body.get('slot') or 1)
        self._json(200, {'ok': True})

    def _api_load(self):
        body = self._body_json()
        if not state.load(body.get('slot') or 1):
            raise ApiError(404, '存档不存在')
        goto_scene(scene_id(), True)
        self._json(200, {'ok': True, 'scene': current_scene(), 'state': state_snapshot()})

    def _api_saves(self):
        self._json(200, {'saves': saves_list()})

    def _api_create_data(self):
        """返回角色创建选项（灵根/体质/出身/姓名表）"""
        tables = getattr(state, 'char_tables', {})
        self._json(200, {
            'ok': True,
            'data': {
                'linggen': tables.get('linggen', []),
                'constitution': tables.get('constitution', []),
                'origin': tables.get('origin', []),
                'names': tables.get('names', {}),
            },
            'labels': {
                'linggen': '灵根',
                'constitution': '体质',
                'origin': '出身',
                'name': '道号',
                'randomName': '随机',
                'startGame': '踏入仙途',
                'restart': '重新开始',
                'loading': '正在加载角色创建数据...',
                'summaryDay': '第',
                'summaryDayUnit': '天',
                'summaryStones': '灵石',
            }
        })

    def _api_all_sects(self):
        """返回所有宗门信息（不含入宗条件等内部字段）"""
        sects_table = getattr(state, 'sects_table', {})
        sects_list = []
        if isinstance(sects_table, dict):
            for sid, sdata in sects_table.items():
                if not isinstance(sdata, dict):
                    continue
                sects_list.append({
                    'id': sid,
                    'name': sdata.get('name'),
                    'alignment': sdata.get('alignment'),
                    'desc': sdata.get('desc'),
                    'specialty': sdata.get('specialty'),
                    'culture': sdata.get('culture'),
                })
        self._json(200, {'ok': True, 'sects': sects_list})

    def _api_export(self):
        disposition = "attachment; filename=save.json; filename*=UTF-8''" + quote('修仙问道-进度.json')
        self._json(200, export_record(), extra={'Content-Disposition': disposition})

    def _api_import(self):
        data = self._body_json()
        st = data.get('state') or data
        if not isinstance(st, dict) or not st.get('scene'):
            raise ApiError(400, '无效存档')
        import_state(st)
        goto_scene(scene_id(), True)
        self._json(200, {'ok': True, 'scene': current_scene(), 'state': state_snapshot()})

    # ---- 静态文件 ----
    def _static(self, pathname):
        pathname = unquote(pathname)
        if pathname == '/':
            file_path = os.path.join(CLIENT_DIR, 'index.html')
        elif pathname.startswith('/css/') or pathname.startswith('/js/') or pathname.startswith('/img/'):
            file_path = os.path.normpath(os.path.join(CLIENT_DIR, pathname.lstrip('/')))
            # 防目录穿越
            if not file_path.startswith(os.path.abspath(CLIENT_DIR) + os.sep):
                return self._text(404, 'Not Found')
        else:
            return self._text(404, 'Not Found')

        ext = os.path.splitext(file_path)[1].lower()
        try:
            with open(file_path, 'rb') as f:  # 二进制读取
                content = f.read()
        except OSError:
            return self._text(404, 'Not Found: ' + pathname)

        if ext in TEXT_EXTS:  # 文本类：utf-8 解码校验后编码回字节
            content = content.decode('utf-8', errors='replace').encode('utf-8')
        self._send(200, content, MIME.get(ext, 'application/octet-stream'))

    # ---- 日志 ----
    def log_message(self, fmt, *args):
        pass  # 静默常规请求日志（与 Node 版行为一致）


def port_in_use(port):
    """预检端口占用（Windows 下 SO_REUSEADDR 不会因占用而绑定失败，须主动探测）"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(('127.0.0.1', port)) == 0


def main():
    if port_in_use(PORT):
        print('[修仙问道] 端口 %d 被占用，请关闭占用程序后重试' % PORT)
        print('[修仙问道] 提示: 可能有正在运行的 server.py / server.js 实例')
        print('[修仙问道] 查看占用: netstat -ano | findstr %d' % PORT)
        sys.exit(1)

    try:
        httpd = ThreadingHTTPServer(('0.0.0.0', PORT), GameHandler)
    except OSError as e:
        print('[修仙问道] 启动失败: %s' % e)
        sys.exit(1)

    httpd.daemon_threads = True
    print('[修仙问道] 服务已启动 → http://localhost:%d' % PORT)
    print('[修仙问道] 按 Ctrl+C 停止服务')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n[修仙问道] 服务已停止')
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()
