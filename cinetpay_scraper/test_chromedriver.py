from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
import sys

def test_chromedriver():
    """Test if ChromeDriver is working properly"""
    try:
        print("Testing ChromeDriver installation...")
        
        # Setup Chrome options
        chrome_options = Options()
        chrome_options.add_argument('--headless')  # Run in background
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--window-size=1920,1080')
        
        # Setup ChromeDriver service
        service = Service(ChromeDriverManager().install())
        
        # Create driver instance
        driver = webdriver.Chrome(service=service, options=chrome_options)
        
        # Test navigation
        print("Navigating to test page...")
        driver.get("https://www.google.com")
        
        # Get page title
        title = driver.title
        print(f"Page title: {title}")
        
        # Close driver
        driver.quit()
        
        print("✅ ChromeDriver test successful!")
        return True
        
    except Exception as e:
        print(f"❌ ChromeDriver test failed: {str(e)}")
        return False

if __name__ == "__main__":
    success = test_chromedriver()
    sys.exit(0 if success else 1)
