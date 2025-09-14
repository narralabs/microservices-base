#include <napi.h>
#include "llama.h"
#include <string>
#include <vector>
#include <memory>
#include <thread>

class LlamaContext : public Napi::ObjectWrap<LlamaContext> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    LlamaContext(const Napi::CallbackInfo& info);
    ~LlamaContext();

private:
    static Napi::FunctionReference constructor;
    Napi::Value Generate(const Napi::CallbackInfo& info);
    
    llama_context* ctx;
    llama_model* model;
    std::string model_path;
    int n_threads;
    int n_ctx;
};

Napi::FunctionReference LlamaContext::constructor;

Napi::Object LlamaContext::Init(Napi::Env env, Napi::Object exports) {
    Napi::HandleScope scope(env);

    Napi::Function func = DefineClass(env, "LlamaContext", {
        InstanceMethod("generate", &LlamaContext::Generate)
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("LlamaContext", func);
    return exports;
}

LlamaContext::LlamaContext(const Napi::CallbackInfo& info) : Napi::ObjectWrap<LlamaContext>(info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
        return;
    }

    model_path = info[0].As<Napi::String>().Utf8Value();
    n_threads = info[1].As<Napi::Number>().Int32Value();
    n_ctx = info[2].As<Napi::Number>().Int32Value();

    llama_backend_init(true);
    
    llama_model_params model_params = llama_model_default_params();
    model = llama_load_model_from_file(model_path.c_str(), model_params);
    
    if (!model) {
        Napi::Error::New(env, "Failed to load model").ThrowAsJavaScriptException();
        return;
    }

    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = n_ctx;
    ctx_params.n_threads = n_threads;
    
    ctx = llama_new_context_with_model(model, ctx_params);
    
    if (!ctx) {
        llama_free_model(model);
        Napi::Error::New(env, "Failed to create context").ThrowAsJavaScriptException();
        return;
    }
}

LlamaContext::~LlamaContext() {
    if (ctx) {
        llama_free(ctx);
    }
    if (model) {
        llama_free_model(model);
    }
    llama_backend_free();
}

Napi::Value LlamaContext::Generate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string prompt = info[0].As<Napi::String>().Utf8Value();
    
    std::vector<llama_token> tokens(n_ctx);
    int n_tokens = llama_tokenize(ctx, prompt.c_str(), prompt.length(), tokens.data(), tokens.size(), true);
    
    if (n_tokens < 0) {
        Napi::Error::New(env, "Failed to tokenize prompt").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (llama_eval(ctx, tokens.data(), n_tokens, 0, n_threads) != 0) {
        Napi::Error::New(env, "Failed to evaluate prompt").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string result;
    const int max_tokens_to_generate = 256;
    
    for (int i = 0; i < max_tokens_to_generate; ++i) {
        float* logits = llama_get_logits(ctx);
        llama_token token = llama_sample_top_p_top_k(ctx, nullptr, 0, 40, 0.95f, 0.05f, 1.0f);
        
        if (token == llama_token_eos()) {
            break;
        }

        char buffer[8];
        int len = llama_token_to_piece(ctx, token, buffer, sizeof(buffer));
        if (len < 0) {
            break;
        }
        
        result.append(buffer, len);

        if (llama_eval(ctx, &token, 1, n_tokens + i, n_threads) != 0) {
            break;
        }
    }

    return Napi::String::New(env, result);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return LlamaContext::Init(env, exports);
}

NODE_API_MODULE(llama_node, Init)
