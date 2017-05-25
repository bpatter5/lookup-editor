# -*- coding: utf-8 -*-
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import Select
from selenium.common.exceptions import NoSuchElementException
from selenium.common.exceptions import NoAlertPresentException
import unittest, time, re

class NewLookupKv(unittest.TestCase):
    def setUp(self):
        self.driver = webdriver.Firefox()
        self.driver.implicitly_wait(30)
        self.base_url = "http://127.0.0.1:8000/en-US/app/lookup_editor/"
        self.verificationErrors = []
        self.accept_next_alert = True
    
    def test_new_lookup_kv(self):
        driver = self.driver
        driver.get(self.base_url + "/en-US/app/lookup_editor/lookup_new")
        for i in range(60):
            try:
                if 2 == len(driver.find_elements_by_css_selector(".lookup-link")): break
            except: pass
            time.sleep(1)
        else: self.fail("time out")
        driver.find_element_by_link_text("Create KV Store Lookup...").click()
        for i in range(60):
            try:
                if "Lookup Edit" == driver.find_element_by_css_selector(".dashboard-title.dashboard-header-title").text: break
            except: pass
            time.sleep(1)
        else: self.fail("time out")
        self.assertEqual("Lookup Edit", driver.find_element_by_css_selector(".dashboard-title.dashboard-header-title").text)
        # ERROR: Caught exception [ERROR: Unsupported command [getEval | window.location.protocol + "//" + window.location.hostname + ":" + window.location.port + window.location.pathname | ]]
        print(base_url)
        self.assertRegexpMatches(driver.current_url, r"^\$\{base_url\}[\s\S]action=new&type=kv$")
        for i in range(60):
            try:
                if 5 == len(driver.find_elements_by_css_selector(".KVStoreFieldView")): break
            except: pass
            time.sleep(1)
        else: self.fail("time out")
        self.assertEqual(5, len(driver.find_elements_by_css_selector(".KVStoreFieldView")))
        driver.find_element_by_link_text("Add another field").click()
        self.assertEqual(6, len(driver.find_elements_by_css_selector(".KVStoreFieldView")))
        driver.find_element_by_css_selector("#kv_store_field_0 .kv-store-field-remove").click()
        self.assertEqual(5, len(driver.find_elements_by_css_selector(".KVStoreFieldView")))
        driver.find_element_by_css_selector("#kv_store_field_1 input").clear()
        driver.find_element_by_css_selector("#kv_store_field_1 input").send_keys("Field")
    
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
