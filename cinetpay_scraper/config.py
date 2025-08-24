# config.py
import os
from datetime import datetime, timedelta

class Config:
    """Configuration settings for the CinetPay scraper"""
    
    # Login credentials (set these as environment variables or replace with your values)
    EMAIL = os.getenv('CINETPAY_EMAIL', 'your_email@example.com')
    PASSWORD = os.getenv('CINETPAY_PASSWORD', 'your_password')
    
    # URLs
    LOGIN_URL = "https://app-new.cinetpay.com/login"
    TRANSACTIONS_URL = "https://app-new.cinetpay.com/transactions/payments"
    
    # Scraping settings
    HEADLESS = False  # Set to True to run browser in background
    MAX_PAGES = None  # Set to a number to limit pages scraped (None for all)
    WAIT_TIMEOUT = 15  # Selenium wait timeout in seconds
    PAGE_DELAY = 2     # Delay between pages in seconds
    
    # Default filter settings
    DEFAULT_FILTERS = {
        'country_code': '225',  # Cote d'ivoire (change as needed)
        'status': 'ACCEPTED',   # ACCEPTED for success, REFUSED for failure, None for all
        'business': None,       # Business ID (None for all businesses)
        'date_range': None      # Will be set dynamically below
    }
    
    # Date range settings (last 30 days by default)
    @staticmethod
    def get_default_date_range():
        """Get default date range (last 30 days)"""
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        return (start_date, end_date)
    
    # Country codes mapping - Only required countries
    COUNTRY_CODES = {
        'Cameroun': '237',
        'Cote d\'ivoire': '225', 
        'Senegal': '221',
        'Burkina Faso': '226',
        'Togo': '228'
    }
    
    # Business options (you can update these based on your account)
    BUSINESS_OPTIONS = {
        'all': '',
        'tombola_sbc': '105903915',
        'sniper_business_center': '5876842'
    }
    
    # Output settings
    OUTPUT_DIR = 'scraped_data'
    CSV_FILENAME_FORMAT = 'cinetpay_transaction_ids_{timestamp}.csv'
    
    # Chrome options - Optimized for performance and stability
    CHROME_OPTIONS = [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-client-side-phishing-detection",
        "--disable-sync",
        "--disable-translate",
        "--disable-ipc-flooding-protection",
        "--disable-extensions",
        "--disable-plugins",
        "--disable-images",
        "--disable-javascript-harmony",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor,TranslateUI,BlinkGenPropertyTrees",
        "--disable-blink-features=AutomationControlled",
        "--disable-default-apps",
        "--disable-background-networking",
        "--disable-background-downloads",
        "--disable-component-extensions-with-background-pages",
        "--disable-logging",
        "--silent",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1200,800",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ]

# Update default filters with date range
Config.DEFAULT_FILTERS['date_range'] = Config.get_default_date_range()