---
id: "19"
slug: "claude-code-configuration-support"
date: "2025-09-08"
title: "Claude Code Configuration Now Supported"
summary: "Configure Claude Code to use any LLM model through LLMGateway's unified API with simple environment variable setup."
draft: true
image:
  src: "/changelog/claude-code-configuration-support.png"
  alt: "Claude Code configuration support on LLM Gateway"
  width: 2282
  height: 1198
---

You can now configure **Claude Code** to work with any LLM model available through LLMGateway! Access models from OpenAI, Google, Anthropic, and more using Claude's powerful CLI interface.

## 🔧 Simple Configuration

Set up Claude Code with LLMGateway using three environment variables:

```bash
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=llmgtwy_.... # your llmgateway.io api key here
export ANTHROPIC_MODEL=glm-4.5v # choose your model with tool support
```

## 🚀 Key Benefits

**Model Flexibility**: Switch between any supported model - from GPT-4o to Claude Sonnet, Gemini, or cost-effective alternatives like GLM-4.5v.

**Cost Optimization**: Choose the most cost-effective model for your specific tasks while maintaining Claude Code's full functionality.

**Tool Support**: Use models that support function calling and tool use for advanced coding workflows.

**Unified Interface**: Single configuration gives you access to the entire ecosystem of LLM models.

## 🎯 Popular Model Options

**OpenAI Models**

- `openai/gpt-5` - OpenAI's Flagship GPT-5 model

**Anthropic Models**

- `anthropic/claude-sonnet-4-20250514` - Anthropic's default model

**Cost-Effective Alternatives**

- `glm-4.5v` - Similar performance with 50-70% cost savings over Anthropic

## 📚 Complete Guide

Read our comprehensive guide: **[Configure Claude Code to Use Any Model via LLMGateway](/blog/how-to-configure-claude-code-with-llmgateway)**

The guide covers:

- ⚙️ Step-by-step setup instructions
- 🔄 Model switching strategies
- 💰 Cost optimization tips
- 📊 Performance comparisons

---

**[Browse all models with tool support](https://llmgateway.io/models?filters=1&tools=true)** to find the perfect fit for your workflow! 🚀
