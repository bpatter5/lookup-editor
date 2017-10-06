import unittest
import sys
import os
import json
import logging

import splunk

sys.path.append( os.path.join("..", "src", "bin") )
sys.path.append( os.path.join("..", "src", "appserver", "controllers") )

from rest_handler import RESTHandler
from lookup_editor import shortcuts, lookup_backups, LookupEditor

logger = logging.getLogger('splunk.appserver.lookup_editor.unit_test')

class LookupEditorTestCase(unittest.TestCase):
    
    def get_session_key(self):
        return splunk.auth.getSessionKey(username='admin', password='changeme')

    def strip_splunk_path(self, file_path):
        etc_start = file_path.find("/etc/")
        return file_path[etc_start:]

class TestLookupEditRESTHandler(LookupEditorTestCase):
    """
    This tests the REST handler to ensure that it is functioning.
    """

    """
    def test_ping_handler(self):
        response, content = splunk.rest.simpleRequest("/services/lookup_edit/lookup_contents", sessionKey=self.get_session_key())
        self.assertEqual(response.status, 404)
    """
    def test_function_signature(self):
        sig = RESTHandler.get_function_signature("get", "test_a_function")
        self.assertEqual(sig, "get_test_a_function")

class TestLookupShortcuts(LookupEditorTestCase):
    """
    This tests the shortcuts class which contains helper functions for managing lookups.
    """

    def test_make_lookup_filename_valid(self):

        # Global lookup
        self.assertEquals(self.strip_splunk_path(shortcuts.make_lookup_filename("test.csv", namespace="some_app")), "/etc/apps/some_app/lookups/test.csv")
        self.assertEquals(self.strip_splunk_path(shortcuts.make_lookup_filename("test.csv")), "/etc/apps/lookup_editor/lookups/test.csv")

        # User lookup
        self.assertEquals(self.strip_splunk_path(shortcuts.make_lookup_filename("test.csv", owner='some_user')), "/etc/users/some_user/lookup_editor/lookups/test.csv")
        self.assertEquals(self.strip_splunk_path(shortcuts.make_lookup_filename("test.csv", namespace="some_app", owner='some_user')), "/etc/users/some_user/some_app/lookups/test.csv")

        # A user of nobody
        self.assertEquals(self.strip_splunk_path(shortcuts.make_lookup_filename("test.csv", owner='nobody')), "/etc/apps/lookup_editor/lookups/test.csv")

        # A user of blank
        self.assertEquals(self.strip_splunk_path(shortcuts.make_lookup_filename("test.csv", owner='')), "/etc/apps/lookup_editor/lookups/test.csv")
        self.assertEquals(self.strip_splunk_path(shortcuts.make_lookup_filename("test.csv", owner=' ')), "/etc/apps/lookup_editor/lookups/test.csv")

    def test_make_lookup_filename_invalid(self):

        # Invalid characters
        self.assertEquals(self.strip_splunk_path(shortcuts.make_lookup_filename("../test.csv")), "/etc/apps/lookup_editor/lookups/test.csv")
        self.assertEquals(self.strip_splunk_path(shortcuts.make_lookup_filename("test.csv", namespace="../some_app")), "/etc/apps/some_app/lookups/test.csv")
        self.assertEquals(self.strip_splunk_path(shortcuts.make_lookup_filename("test.csv", owner="../some_user")), "/etc/users/some_user/lookup_editor/lookups/test.csv")

    def test_flatten_dict(self):

        d = '{ "name" : "Test", "configuration" : { "views" : [ { "name" : "some_view", "app" : "some_app" } ], "delay" : 300, "delay_readable" : "5m", "hide_chrome" : true, "invert_colors" : true }, "_user" : "nobody", "_key" : "123456789" }'
        flattened_d = shortcuts.flatten_dict(json.loads(d))
        self.assertEquals(flattened_d['configuration.delay'], 300)
        self.assertEquals(flattened_d['configuration.views'][0]['app'], 'some_app')
        self.assertEquals(flattened_d['name'], "Test")

    def test_flatten_dict_specified_fields(self):

        d = '{ "name" : "Test", "configuration" : { "views" : [ { "name" : "some_view", "app" : "some_app" } ], "delay" : 300, "delay_readable" : "5m", "hide_chrome" : true, "invert_colors" : true }, "_user" : "nobody", "_key" : "123456789" }'
        flattened_d = shortcuts.flatten_dict(json.loads(d), fields=['name', 'configuration', '_user', '_key'])

        self.assertEquals(flattened_d['name'], 'Test')

        # Now parse the text within the configuration element and make sure it is the expected JSON
        c = json.loads(flattened_d['configuration'])

        self.assertEquals(c['views'][0]["name"], 'some_view')

    def test_flatten_dict_specified_fields_hierarchical(self):
        pass

class TestLookupEditor(LookupEditorTestCase):
    """
    This tests the class which manages lookup backups.
    """

    def setUp(self):
        self.lookup_editor = LookupEditor(logger=logger)

    def test_resolve_lookup_filename(self):
        file_path = self.lookup_editor.resolve_lookup_filename('test.csv', 'search', 'nobody', False,
                                                 None, session_key=self.get_session_key())

        self.assertEquals(self.strip_splunk_path(file_path), '/etc/apps/lookup_editor/lookups/test.csv')

    def test_resolve_lookup_filename_version(self):
        file_path = self.lookup_editor.resolve_lookup_filename('test.csv', 'search', 'nobody', False,
                                                 '1234', session_key=self.get_session_key())

        self.assertEquals(self.strip_splunk_path(file_path), '/etc/apps/lookup_editor/lookups/lookup_file_backups/search/nobody/test.csv/1234')
        
    def test_resolve_lookup_filename_version_no_user(self):
        file_path = self.lookup_editor.resolve_lookup_filename('test.csv', 'search', None, False,
                                                 '1234', session_key=self.get_session_key())

        self.assertEquals(self.strip_splunk_path(file_path), '/etc/apps/lookup_editor/lookups/lookup_file_backups/search/nobody/test.csv/1234')
        
class TestLookupBackups(LookupEditorTestCase):
    """
    This tests the class which manages lookup backups.
    """

    def setUp(self):
        self.lookup_backups = lookup_backups.LookupBackups(logger=logger)

    def test_get_backup_directory(self):
        self.assertEquals(self.strip_splunk_path(self.lookup_backups.get_backup_directory(self.get_session_key(), "test.csv", namespace="search", owner="nobody")), "/etc/apps/lookup_editor/lookups/lookup_file_backups/search/nobody/test.csv")

    def test_get_backup_directory_with_resolved(self):
        self.lookup_editor = LookupEditor(logger=logger)
        resolved_lookup_path = self.lookup_editor.resolve_lookup_filename('test.csv', 'search', 'nobody', False,
                                                                          None, session_key=self.get_session_key())
        self.assertEquals(self.strip_splunk_path(self.lookup_backups.get_backup_directory(self.get_session_key(), "test.csv", namespace="search", owner="nobody", resolved_lookup_path=resolved_lookup_path)), "/etc/apps/lookup_editor/lookups/lookup_file_backups/search/nobody/test.csv")

if __name__ == "__main__":
    loader = unittest.TestLoader()
    suites = []
    suites.append(loader.loadTestsFromTestCase(TestLookupEditRESTHandler))
    suites.append(loader.loadTestsFromTestCase(TestLookupShortcuts))
    suites.append(loader.loadTestsFromTestCase(TestLookupBackups))
    suites.append(loader.loadTestsFromTestCase(TestLookupEditor))

    unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(suites))
