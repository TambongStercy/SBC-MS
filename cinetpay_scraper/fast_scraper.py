#!/usr/bin/env python3
"""
Fast, optimized version of the CinetPay scraper
Focuses on speed and reliability for transaction ID extraction
"""

import time
import json
import pandas as pd
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager
from datetime import datetime, timedelta
import logging
from config import Config

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class FastCinetPayScraper:
    def __init__(self, headless=True):
        """Initialize the fast scraper with performance optimizations"""
        self.driver = None
        self.wait = None
        self.setup_driver(headless)
        
    def setup_driver(self, headless=True):
        """Set up Chrome driver optimized for speed"""
        chrome_options = Options()
        
        # Performance-focused options
        fast_options = [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-images",  # Don't load images
            "--disable-javascript",  # Disable JS where possible
            "--disable-plugins",
            "--disable-extensions",
            "--disable-logging",
            "--silent",
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor",
            "--no-first-run",
            "--window-size=1200,600"
        ]
        
        for option in fast_options:
            chrome_options.add_argument(option)
            
        if headless:
            chrome_options.add_argument("--headless")
        
        # Disable images and CSS for faster loading
        prefs = {
            "profile.managed_default_content_settings.images": 2,
            "profile.default_content_setting_values.notifications": 2,
            "profile.managed_default_content_settings.stylesheets": 2,
            "profile.managed_default_content_settings.cookies": 2,
            "profile.managed_default_content_settings.javascript": 1,
            "profile.managed_default_content_settings.plugins": 2,
            "profile.managed_default_content_settings.popups": 2,
            "profile.managed_default_content_settings.geolocation": 2,
            "profile.managed_default_content_settings.media_stream": 2,
        }
        chrome_options.add_experimental_option("prefs", prefs)
        
        try:
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            self.wait = WebDriverWait(self.driver, 10)
            logger.info("Fast Chrome driver initialized")
        except Exception as e:
            logger.error(f"Failed to initialize driver: {str(e)}")
            raise

    def login(self):
        """Quick login"""
        try:
            logger.info("Logging in...")
            self.driver.get(Config.LOGIN_URL)
            
            # Quick login
            email_field = self.wait.until(EC.presence_of_element_located((By.NAME, "email")))
            email_field.send_keys(Config.EMAIL)
            
            password_field = self.driver.find_element(By.NAME, "password")
            password_field.send_keys(Config.PASSWORD)
            
            login_button = self.driver.find_element(By.XPATH, "//button[@type='submit']")
            login_button.click()
            
            # Wait for login
            self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, "layout-wrapper")))
            logger.info("✅ Login successful")
            
        except Exception as e:
            logger.error(f"❌ Login failed: {str(e)}")
            raise

    def set_filters_fast(self, country_code, date_range):
        """Set filters quickly"""
        try:
            # Navigate to transactions
            self.driver.get(Config.TRANSACTIONS_URL)
            time.sleep(2)
            
            # Set country
            country_select = Select(self.driver.find_element(By.CSS_SELECTOR, "select[wire\\:model\\.defer='country']"))
            country_select.select_by_value(country_code)
            
            # Set status to ACCEPTED
            status_select = Select(self.driver.find_element(By.CSS_SELECTOR, "select[wire\\:model\\.lazy='status']"))
            status_select.select_by_value("ACCEPTED")
            
            # Set date range
            start_date, end_date = date_range
            date_input = self.driver.find_element(By.CSS_SELECTOR, "input[wire\\:model\\.lazy='date']")
            date_input.clear()
            date_input.send_keys(f"{start_date} - {end_date}")
            
            # Apply filters
            submit_btn = self.driver.find_element(By.CSS_SELECTOR, "button[type='submit']")
            submit_btn.click()
            
            time.sleep(3)  # Wait for results
            logger.info(f"✅ Filters applied for country {country_code}")
            
        except Exception as e:
            logger.error(f"❌ Failed to set filters: {str(e)}")
            raise

    def extract_transaction_ids_fast(self):
        """Fast extraction of just transaction IDs"""
        transaction_ids = []
        
        try:
            # Wait for table
            self.wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, ".payments-collected-table tbody tr")))
            
            # Get all rows
            rows = self.driver.find_elements(By.CSS_SELECTOR, ".payments-collected-table tbody tr")
            
            for row in rows:
                try:
                    cells = row.find_elements(By.TAG_NAME, "td")
                    if len(cells) >= 2:
                        txn_id = cells[1].text.strip()
                        if txn_id and txn_id != "":
                            transaction_ids.append(txn_id)
                except:
                    continue
            
            return transaction_ids
            
        except Exception as e:
            logger.error(f"Failed to extract transaction IDs: {str(e)}")
            return []

    def has_next_page(self):
        """Check if next page exists"""
        try:
            next_buttons = self.driver.find_elements(By.CSS_SELECTOR, ".pagination .page-item:last-child")
            if next_buttons:
                return "disabled" not in next_buttons[0].get_attribute("class")
            return False
        except:
            return False

    def go_next_page(self):
        """Go to next page quickly"""
        try:
            next_button = self.driver.find_element(By.CSS_SELECTOR, ".pagination .page-item:last-child button")
            self.driver.execute_script("arguments[0].click();", next_button)
            time.sleep(2)  # Wait for page load
            return True
        except:
            return False

    def scrape_country_fast(self, country_name, country_code, date_range, max_pages=None):
        """Fast scraping for a single country"""
        logger.info(f"🚀 Fast scraping {country_name} ({country_code})")
        
        all_transaction_ids = []
        
        try:
            # Set filters
            self.set_filters_fast(country_code, date_range)
            
            page = 1
            while True:
                if max_pages and page > max_pages:
                    break
                
                # Extract transaction IDs from current page
                page_ids = self.extract_transaction_ids_fast()
                all_transaction_ids.extend(page_ids)
                
                logger.info(f"📄 Page {page}: {len(page_ids)} transaction IDs")
                
                # Check for next page
                if not self.has_next_page():
                    break
                
                # Go to next page
                if not self.go_next_page():
                    break
                
                page += 1
            
            logger.info(f"✅ {country_name}: {len(all_transaction_ids)} total transaction IDs")
            return all_transaction_ids
            
        except Exception as e:
            logger.error(f"❌ Failed to scrape {country_name}: {str(e)}")
            return []

    def save_transaction_ids(self, transaction_ids, country_name):
        """Save transaction IDs to CSV"""
        if not transaction_ids:
            return None
            
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"fast_txn_ids_{country_name.lower().replace(' ', '_').replace("'", "")}_{timestamp}.csv"
        
        import os
        os.makedirs(Config.OUTPUT_DIR, exist_ok=True)
        filepath = os.path.join(Config.OUTPUT_DIR, filename)
        
        # Create DataFrame with just transaction IDs
        df = pd.DataFrame({'transaction_id': transaction_ids})
        df.to_csv(filepath, index=False)
        
        logger.info(f"💾 Saved {len(transaction_ids)} transaction IDs to {filepath}")
        return filepath

    def close(self):
        """Close browser"""
        if self.driver:
            self.driver.quit()

def main():
    """Fast scraping of all countries"""
    print("=== Fast CinetPay Transaction ID Scraper ===")
    
    # Setup
    date_range = Config.get_default_date_range()
    print(f"📅 Date range: {date_range[0]} to {date_range[1]}")
    print("⚡ Mode: Fast (transaction IDs only)")
    
    scraper = FastCinetPayScraper(headless=False)  # Set to True for headless
    
    try:
        # Login once
        scraper.login()
        
        total_ids = 0
        
        # Scrape each country
        for country_name, country_code in Config.COUNTRY_CODES.items():
            transaction_ids = scraper.scrape_country_fast(country_name, country_code, date_range)
            
            if transaction_ids:
                scraper.save_transaction_ids(transaction_ids, country_name)
                total_ids += len(transaction_ids)
            
            time.sleep(1)  # Brief pause between countries
        
        print(f"\n🎉 Fast scraping completed!")
        print(f"📊 Total transaction IDs: {total_ids}")
        
    except Exception as e:
        print(f"❌ Fast scraping failed: {str(e)}")
    finally:
        scraper.close()

if __name__ == "__main__":
    main()