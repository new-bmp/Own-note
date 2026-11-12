"""Local, authenticated debugger transport. User stdin/stdout stay separate."""
import ast
import json
import os
import queue
import socket
import sys
import threading
import traceback

target = os.path.abspath(sys.argv[1])
connection = socket.create_connection(("127.0.0.1", int(os.environ["OWN_DEBUG_PORT"])))
stream = connection.makefile("rw", encoding="utf-8", newline="\n", buffering=1)
commands = queue.Queue()
mode, anchor, breakpoints, watches = "step", 0, set(), []
pause_requested = threading.Event()

def send(value):
    stream.write(json.dumps(value, ensure_ascii=False) + "\n")
    stream.flush()

send({"token": os.environ["OWN_DEBUG_TOKEN"]})

def listen():
    try:
        for line in stream:
            item = json.loads(line)
            if item.get("action") == "pause":
                pause_requested.set()
            else:
                commands.put(item)
    finally:
        os._exit(0)

threading.Thread(target=listen, daemon=True).start()

def representation(value):
    try:
        text = repr(value)
        return text[:4000] + ("…" if len(text) > 4000 else "")
    except BaseException:
        return "<无法显示>"

def watch_value(expression, frame):
    try:
        tree = ast.parse(expression, mode="eval")
        if any(isinstance(node, (ast.Call, ast.NamedExpr, ast.Lambda, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp, ast.Await)) for node in ast.walk(tree)):
            raise ValueError("观察表达式不能调用函数或修改变量")
        return {"name": expression, "value": representation(eval(compile(tree, "<watch>", "eval"), frame.f_globals, frame.f_locals))}
    except BaseException as error:
        return {"name": expression, "value": str(error), "error": True}

def snapshot(frame, reason):
    frames = []
    current = frame
    while current and len(frames) < 25:
        if os.path.abspath(current.f_code.co_filename) == target:
            frames.append({"name": current.f_code.co_name, "line": current.f_lineno})
        current = current.f_back
    variables = []
    seen = set()
    for scope, values in (("局部", frame.f_locals), ("全局", frame.f_globals)):
        for name, value in list(values.items()):
            if name.startswith("__") or name in seen or len(variables) >= 100:
                continue
            seen.add(name)
            variables.append({"name": name, "value": representation(value), "type": type(value).__name__, "scope": scope})
    send({"event": "paused", "line": frame.f_lineno, "reason": reason, "frames": frames,
          "variables": variables, "watches": [watch_value(item, frame) for item in watches]})

def trace(frame, event, argument):
    global mode, anchor, breakpoints, watches
    if os.path.abspath(frame.f_code.co_filename) != target:
        return trace
    depth = 0
    current = frame
    while current:
        depth += 1
        current = current.f_back
    stop = event == "line" and (mode == "step" or mode == "next" and depth <= anchor or mode == "out" and depth < anchor or frame.f_lineno in breakpoints or pause_requested.is_set())
    if not stop:
        return trace
    pause_requested.clear()
    snapshot(frame, "断点" if frame.f_lineno in breakpoints else "单步暂停")
    while True:
        command = commands.get()
        action = command.get("action")
        if action == "configure":
            breakpoints = set(command.get("breakpoints", []))
            watches = command.get("watches", [])
            snapshot(frame, "已更新观察")
        elif action in ("step", "next", "out", "continue"):
            mode, anchor = action, depth
            break
        elif action == "stop":
            os._exit(0)
    return trace

namespace = {"__name__": "__main__", "__file__": target}
try:
    with open(target, "r", encoding="utf-8") as source:
        program = compile(source.read(), target, "exec")
    sys.settrace(trace)
    exec(program, namespace, namespace)
except SystemExit:
    raise
except BaseException:
    traceback.print_exc()
    sys.exit(1)
finally:
    sys.settrace(None)
