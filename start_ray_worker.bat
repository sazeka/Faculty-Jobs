@echo off
set RAY_ENABLE_WINDOWS_OR_OSX_CLUSTER=1
set RAY_DEFAULT_PYTHON_VERSION_MATCH_LEVEL=minor
.venv\Scripts\ray.exe start --address=192.168.1.118:6379 --resources="{\"summarizer_node\": 1}"
