# -*- coding: utf-8 -*-
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import Select
from selenium.common.exceptions import NoSuchElementException
from selenium.common.exceptions import NoAlertPresentException
import unittest, time, re

class EditorLoadCsv(unittest.TestCase):
    def setUp(self):
        self.driver = webdriver.Firefox()
        self.driver.implicitly_wait(30)
        self.base_url = "http://127.0.0.1:8000/en-US/app/lookup_editor/"
        self.verificationErrors = []
        self.accept_next_alert = True
    
    def test_editor_load_csv(self):
        driver = self.driver
        driver.get(self.base_url + "/en-US/app/lookup_editor/lookup_edit?owner=admin&namespace=lookup_editor&lookup=ui_test.csv&type=csv")
        # ERROR: Caught exception [Error: locator strategy either id or name must be specified explicitly.]
        driver.find_element_by_id("save").click()
        for i in range(60):
            try:
                if "Lookup file saved successfully" == driver.find_element_by_css_selector("#info-message > .message").text: break
            except: pass
            time.sleep(1)
        else: self.fail("time out")
        self.assertEqual("Lookup file saved successfully", driver.find_element_by_css_selector("#info-message > .message").text)
        # Revert to a previous version and make sure it loads
        driver.find_element_by_link_text("Revert to previous version").click()
        driver.find_element_by_css_selector("#backup-versions > li > a").click()
        self.assertEqual("This version the lookup file will now be loaded.\n\nUnsaved changes will be overridden.", self.close_alert_and_get_its_text())
        for i in range(60):
            try:
                if "Backup file was loaded successfully" == driver.find_element_by_css_selector("#info-message > .message").text: break
            except: pass
            time.sleep(1)
        else: self.fail("time out")
        self.assertEqual("Backup file was loaded successfully", driver.find_element_by_css_selector("#info-message > .message").text)
    
    def is_element_present(self, how, what):
        try: self.driver.find_element(by=how, value=what)
        except NoSuchElementException as e: return False
        return True
    
    def is_alert_present(self):
        try: self.driver.switch_to_alert()
        except NoAlertPresentException as e: return False
        return True
    
    def close_alert_and_get_its_text(self):
        try:
            alert = self.driver.switch_to_alert()
            alert_text = alert.text
            if self.accept_next_alert:
                alert.accept()
            else:
                alert.dismiss()
            return alert_text
        finally: self.accept_next_alert = True
    
    def tearDown(self):
        self.driver.quit()
        self.assertEqual([], self.verificationErrors)

if __name__ == "__main__":
    unittest.main()
