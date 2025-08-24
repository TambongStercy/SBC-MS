import time
import json
import csv
import pandas as pd
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import TimeoutException, NoSuchElementException, ElementClickInterceptedException
from selenium.webdriver.common.action_chains import ActionChains
from webdriver_manager.chrome import ChromeDriverManager
from datetime import datetime, timedelta
import logging
from config import Config

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ImprovedCinetPayScraper:
    def __init__(self, headless=False):
        """Initialize the scraper"""
        self.driver = None
        self.wait = None
        self.actions = None
        self.setup_driver(headless)
        
    def setup_driver(self, headless=False):
        """Set up Chrome driver with improved options"""
        chrome_options = Options()
        
        # Add Chrome options for better stability
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)
        
        if headless:
            chrome_options.add_argument("--headless")
        
        service = Service(ChromeDriverManager().install())
        self.driver = webdriver.Chrome(service=service, options=chrome_options)
        self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        self.wait = WebDriverWait(self.driver, 15)
        self.actions = ActionChains(self.driver)
        
    def login(self, email=None, password=None, login_url=None):
        """Login to CinetPay"""
        email = email or Config.EMAIL
        password = password or Config.PASSWORD
        login_url = login_url or Config.LOGIN_URL
        
        try:
            logger.info("Navigating to login page...")
            self.driver.get(login_url)
            
            # Wait for and fill email
            email_field = self.wait.until(EC.presence_of_element_located((By.NAME, "email")))
            email_field.clear()
            email_field.send_keys(email)
            
            # Fill password
            password_field = self.driver.find_element(By.NAME, "password")
            password_field.clear()
            password_field.send_keys(password)
            
            # Click login button
            login_button = self.driver.find_element(By.XPATH, "//button[@type='submit']")
            login_button.click()
            
            # Wait for successful login
            self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, "layout-wrapper")))
            logger.info("Login successful!")
            
        except Exception as e:
            logger.error(f"Login failed: {str(e)}")
            raise
    
    def navigate_to_transactions(self):
        """Navigate to transactions page"""
        try:
            self.driver.get(Config.TRANSACTIONS_URL)
            self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, "payments-collected-table")))
            logger.info("Successfully navigated to transactions page")
        except Exception as e:
            logger.error(f"Failed to navigate: {str(e)}")
            raise
    
    def set_filters(self, country_code=None, status=None, date_range=None, business=None):
        """Set filters with improved error handling"""
        try:
            logger.info("Setting filters...")
            
            # Set business filter first
            if business:
                try:
                    business_select = Select(self.wait.until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, "select[wire\\:model\\.defer='business']"))
                    ))
                    business_select.select_by_value(business)
                    logger.info(f"Selected business: {business}")
                    time.sleep(1)
                except Exception as e:
                    logger.warning(f"Could not set business filter: {str(e)}")
            
            # Set country filter
            if country_code:
                try:
                    country_select = Select(self.wait.until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, "select[wire\\:model\\.defer='country']"))
                    ))
                    country_select.select_by_value(country_code)
                    logger.info(f"Selected country code: {country_code}")
                    time.sleep(1)
                except Exception as e:
                    logger.warning(f"Could not set country filter: {str(e)}")
            
            # Set status filter
            if status:
                try:
                    status_select = Select(self.wait.until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, "select[wire\\:model\\.lazy='status']"))
                    ))
                    status_select.select_by_value(status)
                    logger.info(f"Selected status: {status}")
                    time.sleep(1)
                except Exception as e:
                    logger.warning(f"Could not set status filter: {str(e)}")
            
            # Set date range
            if date_range:
                try:
                    start_date, end_date = date_range
                    date_input = self.wait.until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, "input[wire\\:model\\.lazy='date']"))
                    )
                    date_input.clear()
                    time.sleep(0.5)
                    date_input.send_keys(f"{start_date} - {end_date}")
                    logger.info(f"Set date range: {start_date} to {end_date}")
                    time.sleep(1)
                except Exception as e:
                    logger.warning(f"Could not set date range: {str(e)}")
            
            # Apply filters
            try:
                validate_button = self.wait.until(
                    EC.element_to_be_clickable((By.CSS_SELECTOR, "button[type='submit']"))
                )
                self.driver.execute_script("arguments[0].click();", validate_button)
                logger.info("Applied filters")
                
                # Wait for table to update
                time.sleep(3)
                self.wait_for_table_load()
            except Exception as e:
                logger.warning(f"Could not apply filters: {str(e)}")
            
        except Exception as e:
            logger.error(f"Failed to set filters: {str(e)}")
            raise
    
    def wait_for_table_load(self):
        """Wait for table to finish loading"""
        try:
            # Wait for loader to disappear
            WebDriverWait(self.driver, 10).until(
                EC.invisibility_of_element_located((By.ID, "loader"))
            )
        except TimeoutException:
            pass
        
        # Wait for table rows
        try:
            self.wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, ".payments-collected-table tbody tr")))
        except TimeoutException:
            logger.warning("No transactions found on this page")
    
    def extract_table_data(self):
        """Extract transaction IDs from current page"""
        transaction_ids = []
        
        try:
            # Wait a bit for the page to fully load
            time.sleep(2)
            
            # Find all transaction ID cells (2nd column in the table)
            id_cells = self.driver.find_elements(
                By.CSS_SELECTOR, 
                ".payments-collected-table tbody tr td:nth-child(2)"
            )
            
            # Extract just the transaction IDs
            for cell in id_cells:
                transaction_id = cell.text.strip()
                if transaction_id:  # Only add non-empty IDs
                    transaction_ids.append({'transaction_id': transaction_id})
            
            logger.info(f"Extracted {len(transaction_ids)} transaction IDs from current page")
            return transaction_ids
            
        except Exception as e:
            logger.error(f"Failed to extract table data: {str(e)}")
            return []
    
    def get_pagination_info(self):
        """Get pagination information"""
        try:
            # Get current page
            current_page_element = self.driver.find_element(By.CSS_SELECTOR, ".pagination .page-item.active .page-link")
            current_page = int(current_page_element.text)
            
            # Get total pages
            page_links = self.driver.find_elements(By.CSS_SELECTOR, ".pagination .page-item .page-link")
            total_pages = 1
            for link in page_links:
                try:
                    page_num = int(link.text)
                    total_pages = max(total_pages, page_num)
                except ValueError:
                    continue
            
            # Check if next page is available
            next_buttons = self.driver.find_elements(By.CSS_SELECTOR, ".pagination .page-item:last-child")
            has_next = len(next_buttons) > 0 and "disabled" not in next_buttons[0].get_attribute("class")
            
            return {
                'current_page': current_page,
                'total_pages': total_pages,
                'has_next': has_next
            }
            
        except Exception as e:
            logger.warning(f"Could not get pagination info: {str(e)}")
            return {'current_page': 1, 'total_pages': 1, 'has_next': False}
    
    def go_to_next_page(self):
        """Navigate to next page with improved click handling"""
        try:
            # Scroll to bottom to ensure pagination is visible
            self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(1)
            
            # Find the next button
            next_button = self.wait.until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, ".pagination .page-item:last-child button"))
            )
            
            # Check if button is disabled
            parent_li = next_button.find_element(By.XPATH, "..")
            if "disabled" in parent_li.get_attribute("class"):
                return False
            
            # Try multiple click methods
            try:
                # Method 1: Regular click
                next_button.click()
            except ElementClickInterceptedException:
                try:
                    # Method 2: JavaScript click
                    self.driver.execute_script("arguments[0].click();", next_button)
                except:
                    try:
                        # Method 3: Action chains
                        self.actions.move_to_element(next_button).click().perform()
                    except:
                        logger.error("All click methods failed")
                        return False
            
            # Wait for page to load
            time.sleep(2)
            self.wait_for_table_load()
            return True
            
        except Exception as e:
            logger.error(f"Failed to go to next page: {str(e)}")
            return False
    
    def scrape_single_country(self, country_code, country_name, status=None, date_range=None, business=None, max_pages=None):
        """Scrape all pages for a single country"""
        logger.info(f"Starting scrape for {country_name} ({country_code})")
        
        all_transactions = []
        
        try:
            # Set filters for this country
            self.set_filters(
                country_code=country_code,
                status=status,
                date_range=date_range,
                business=business
            )
            
            page_count = 0
            while True:
                page_count += 1
                
                # Check max pages limit
                if max_pages and page_count > max_pages:
                    logger.info(f"Reached max pages limit for {country_name}: {max_pages}")
                    break
                
                # Get pagination info
                pagination_info = self.get_pagination_info()
                logger.info(f"{country_name} - Page {pagination_info['current_page']} of {pagination_info['total_pages']}")
                
                # Extract transaction IDs from current page
                page_transactions = self.extract_table_data()
                all_transactions.extend(page_transactions)
                
                # Check if there's a next page
                if not pagination_info['has_next']:
                    logger.info(f"Reached last page for {country_name}")
                    break
                
                # Go to next page
                if not self.go_to_next_page():
                    logger.info(f"Could not navigate to next page for {country_name}")
                    break
                
                # Small delay between pages
                time.sleep(1)
            
            logger.info(f"Completed {country_name}: {len(all_transactions)} transactions from {page_count} pages")
            return all_transactions
            
        except Exception as e:
            logger.error(f"Error scraping {country_name}: {str(e)}")
            return all_transactions
    
    def scrape_all_countries(self, status=None, date_range=None, business=None, max_pages_per_country=None):
        """Scrape all countries sequentially"""
        all_transactions = []
        
        for country_name, country_code in Config.COUNTRY_CODES.items():
            try:
                logger.info(f"\n{'='*50}")
                logger.info(f"SCRAPING: {country_name.upper().replace('_', ' ')} ({country_code})")
                logger.info(f"{'='*50}")
                
                # Navigate back to transactions page for each country
                self.navigate_to_transactions()
                time.sleep(2)
                
                # Scrape this country
                country_transactions = self.scrape_single_country(
                    country_code=country_code,
                    country_name=country_name.replace('_', ' ').title(),
                    status=status,
                    date_range=date_range,
                    business=business,
                    max_pages=max_pages_per_country
                )
                
                all_transactions.extend(country_transactions)
                
                logger.info(f"Total transactions so far: {len(all_transactions)}")
                
                # Small delay between countries
                time.sleep(2)
                
            except Exception as e:
                logger.error(f"Failed to scrape {country_name}: {str(e)}")
                continue
        
        logger.info(f"\n{'='*50}")
        logger.info(f"SCRAPING COMPLETED - TOTAL: {len(all_transactions)} transactions")
        logger.info(f"{'='*50}")
        
        return all_transactions
    
    def save_to_csv(self, transactions, filename=None):
        """Save transaction IDs to CSV with debugging"""
        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"cinetpay_transaction_ids_{timestamp}.csv"
        
        # Create output directory if needed
        import os
        os.makedirs(Config.OUTPUT_DIR, exist_ok=True)
        full_path = os.path.join(Config.OUTPUT_DIR, filename)
        
        logger.info(f"DEBUG: Attempting to save {len(transactions)} transactions")
        logger.info(f"DEBUG: First few transactions: {transactions[:3] if transactions else 'None'}")
        
        if not transactions:
            logger.warning("No transaction IDs to save")
            # Create empty file with header only
            with open(full_path, 'w', newline='', encoding='utf-8') as csvfile:
                writer = csv.writer(csvfile)
                writer.writerow(['transaction_id'])
            return full_path
        
        try:
            # Create a simple CSV with just transaction IDs
            with open(full_path, 'w', newline='', encoding='utf-8') as csvfile:
                writer = csv.writer(csvfile)
                writer.writerow(['transaction_id'])  # Write header
                
                count = 0
                for tx in transactions:
                    if isinstance(tx, dict) and 'transaction_id' in tx:
                        writer.writerow([tx['transaction_id']])
                        count += 1
                    else:
                        logger.warning(f"DEBUG: Invalid transaction format: {tx}")
            
            logger.info(f"✅ {count} transaction IDs saved to {full_path}")
            return full_path
            
        except Exception as e:
            logger.error(f"❌ Failed to save transaction IDs: {str(e)}")
            logger.error(f"DEBUG: Error details - transactions type: {type(transactions)}")
            return full_path
    
    def get_summary_stats(self, transactions):
        """Get summary statistics"""
        if not transactions:
            return {}
        
        stats = {'total_transactions': len(transactions)}
        
        # Group by country
        countries = {}
        for transaction in transactions:
            country = transaction.get('country_name', 'Unknown')
            countries[country] = countries.get(country, 0) + 1
        
        stats['countries'] = countries
        
        # Other stats
        try:
            df = pd.DataFrame(transactions)
            
            if 'status' in df.columns:
                stats['status_breakdown'] = df['status'].value_counts().to_dict()
            
            if 'payment_method' in df.columns:
                stats['payment_methods'] = df['payment_method'].value_counts().to_dict()
            
            if 'currency' in df.columns:
                stats['currencies'] = df['currency'].value_counts().to_dict()
                
        except:
            pass
        
        return stats
    
    def close(self):
        """Close browser"""
        if self.driver:
            self.driver.quit()
            logger.info("Browser closed")