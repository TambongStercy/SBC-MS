# test_chromedriver.py
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

def test_chromedriver():
    """Test if ChromeDriver is working properly"""
    try:
        print("Setting up ChromeDriver...")
        
        # Setup Chrome options
        chrome_options = Options()
        # chrome_options.add_argument("--headless")  # Uncomment for headless mode
        
        # Setup ChromeDriver service
        service = Service(ChromeDriverManager().install())
        
        # Create driver
        driver = webdriver.Chrome(service=service, options=chrome_options)
        
        print("ChromeDriver started successfully!")
        
        # Test navigation
        print("Navigating to Google...")
        driver.get("https://www.google.com")
        
        print(f"Page title: {driver.title}")
        print("✅ ChromeDriver is working perfectly!")
        
        # Close browser
        driver.quit()
        print("Browser closed.")
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        print("ChromeDriver setup failed. Please check your installation.")

if __name__ == "__main__":
    test_chromedriver()