"""
Ray Serve deployment wrapping summarizer_gpu.py.

Start a Ray cluster, then deploy with:
    serve run ray_summarizer:deployment

See the plan notes for full startup instructions.
"""

import os, json

# Tell summarizer_gpu to skip standalone init (model loading, cache, FastAPI)
os.environ["SUMMARIZER_RAY_MODE"] = "1"

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from fastapi import FastAPI
from ray import serve

# Import helpers from the existing summarizer — no duplication
from summarizer_gpu import (
    Job,
    SummarizeRequest,
    key_for,
    summarize_one,
    get_device,
)

HF_MODEL = os.environ.get("HF_MODEL", "Qwen/Qwen2.5-7B-Instruct")
CACHE_PATH = os.path.join(".cache", "summaries.json")

fast_app = FastAPI()


@serve.deployment(
    num_replicas=2,
    ray_actor_options={"resources": {"summarizer_node": 1}},
)
@serve.ingress(fast_app)
class Summarizer:
    def __init__(self):
        self.device = get_device()
        print(f"[ray] Loading {HF_MODEL} on {self.device}")

        self.tokenizer = AutoTokenizer.from_pretrained(HF_MODEL, use_fast=True)
        self.tokenizer.pad_token = self.tokenizer.eos_token

        if self.device == "mps":
            self.model = AutoModelForCausalLM.from_pretrained(
                HF_MODEL, dtype=torch.float16, low_cpu_mem_usage=True
            ).to("mps")
        elif self.device == "cuda":
            self.model = AutoModelForCausalLM.from_pretrained(
                HF_MODEL, dtype=torch.float16, device_map="auto"
            )
        else:
            self.model = AutoModelForCausalLM.from_pretrained(HF_MODEL)

        self.model.config.pad_token_id = self.tokenizer.eos_token_id

        # Per-node summary cache
        os.makedirs(".cache", exist_ok=True)
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                self.cache = json.load(f)
        except Exception:
            self.cache = {}

        print(f"[ray] Ready on {self.device}, cache has {len(self.cache)} entries")

    def _save_cache(self):
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, indent=2)

    @fast_app.post("/summarize")
    async def summarize(self, req: SummarizeRequest):
        out = []
        for job in req.jobs:
            k = key_for(job)
            if k in self.cache:
                out.append({**job.dict(), **self.cache[k]})
                continue
            enriched = summarize_one(
                job,
                req.max_new_tokens or 220,
                model=self.model,
                tokenizer=self.tokenizer,
                device=self.device,
            )
            self.cache[k] = enriched
            out.append({**job.dict(), **enriched})

        self._save_cache()
        return {"jobs": out}


# Bind the deployment — used by `serve run ray_summarizer:deployment`
deployment = Summarizer.bind()
