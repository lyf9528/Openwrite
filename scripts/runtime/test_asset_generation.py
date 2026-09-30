import importlib.util
import json
import pathlib
import types
import unittest
from unittest.mock import Mock, patch
from contextlib import nullcontext

spec = importlib.util.spec_from_file_location('asset_runtime', pathlib.Path(__file__).with_name('managed_entry.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
from tools.studio_contracts import StudioError


class GenerationTests(unittest.TestCase):
    def app(self):
        app = Mock()
        app.project_root = pathlib.Path('/tmp/ai-test-project')
        profile = {'id': 'test', 'label': '测试模型', 'model': 'test-model'}
        app._operation_profile.return_value = profile
        app._model_profile_store.resolve_profile.return_value = profile
        app._model_context.return_value = nullcontext()
        app._assets.return_value.list.return_value = []
        return app

    def run_model(self, payload, response, app=None):
        app = app or self.app()
        with patch('tools.llm.LLMConfig.from_env') as config, patch('tools.llm.LLMClient') as client:
            config.return_value = types.SimpleNamespace(max_retries=3, timeout_seconds=60, max_tokens=8000)
            client.return_value.chat.return_value = types.SimpleNamespace(content=json.dumps(response, ensure_ascii=False))
            result = module.generate_asset(app, payload)
            return result, app, client

    def test_named_profile_and_no_persistence(self):
        result, app, client = self.run_model({'kind': 'character', 'profile_id': 'test', 'instructions': '谨慎的侦探'}, {'name': '林知夏', 'summary': '调查员', 'personality': '谨慎', 'api_key': 'model-injected', 'id': 'bad'})
        app._model_profile_store.resolve_profile.assert_called_once_with('test', operation='goethe')
        self.assertEqual(result['draft'], {'name': '林知夏', 'summary': '调查员', 'personality': '谨慎'})
        app._assets.assert_not_called()
        app.create_asset.assert_not_called()
        self.assertEqual(client.return_value.chat.call_count, 1)

    def test_stage_validation_and_generated_ids(self):
        stage = {'id': '../bad', 'name': '初阶', 'abilities': ['火感知'], 'limitations': ['消耗精力'], 'requirements': ['完成训练']}
        result, app, _ = self.run_model({'kind': 'progression', 'count': 2, 'progression_kind': 'cultivation'}, {'name': '御火', 'summary': '火焰修炼', 'stages': [stage, stage]})
        self.assertEqual([s['id'] for s in result['draft']['stages']], ['stage_1', 'stage_2'])
        self.assertEqual(result['draft']['kind'], 'cultivation')
        app._operation_profile.assert_called_once_with('goethe')
        with self.assertRaises(StudioError):
            module.validate_result(json.dumps({'name': 'x', 'summary': 'x', 'stages': [stage]}), 'progression', 'asset', 2, 'ability')
        with self.assertRaises(StudioError):
            module.validate_result('not-json', 'world', 'asset', 6, 'ability')

    def test_names_and_fences(self):
        self.assertEqual(module.validate_result('```json\n{"names":["林云","林云","林月"]}\n```', 'character', 'names', 6, 'ability'), {'names': ['林云', '林月']})
        with self.assertRaises(StudioError):
            module.validate_result('{"names": [""]}', 'world', 'names', 6, 'ability')

    def test_context_uses_current_workspace_only(self):
        app = self.app()
        app._assets.return_value.list.side_effect = lambda kind: [{'id': 'world_a', 'name': '城邦'}] if kind == 'world' else []
        app._assets.return_value.read.return_value = {'data': {'summary': '城邦禁止火焰'}, 'body_markdown': '守卫巡查'}
        _, _, client = self.run_model({'kind': 'world', 'include_context': True}, {'name': '灰城', 'summary': '禁火城邦'}, app)
        prompt = client.return_value.chat.call_args.args[0][1].content
        self.assertIn('城邦禁止火焰', prompt)
        app._assets.return_value.read.assert_called_once_with('world', 'world_a')

    def test_errors_do_not_leak_provider_secrets_and_release_lock(self):
        app = self.app()
        with patch('tools.llm.LLMConfig.from_env', side_effect=RuntimeError('secret-api-key')):
            with self.assertRaises(StudioError) as error:
                module.generate_asset(app, {'kind': 'world'})
        self.assertNotIn('secret-api-key', str(error.exception))
        result, _, _ = self.run_model({'kind': 'world', 'mode': 'names'}, {'names': ['云城']}, app)
        self.assertEqual(result['names'], ['云城'])

    def test_concurrent_requests_are_rejected(self):
        app = self.app()
        gate = module._locks.setdefault(str(app.project_root), __import__('threading').Lock())
        gate.acquire()
        try:
            with self.assertRaises(StudioError) as error:
                module.generate_asset(app, {'kind': 'world'})
            self.assertEqual(error.exception.code, 'ASSET_GENERATION_BUSY')
        finally:
            gate.release()

    def test_route_registration(self):
        module.install()
        from tools.studio_application import StudioApplication
        from tools.studio_http import POST_ROUTES
        self.assertIs(StudioApplication.generate_asset_preview, module.generate_asset)
        self.assertTrue(POST_ROUTES['/api/assets/generate'].envelope)
        self.assertTrue(POST_ROUTES['/api/assets/generate'].requires_project)


if __name__ == '__main__':
    unittest.main()
