# setup.py
"""
Setup script for CinetPay Transaction Scraper
"""

import os
import subprocess
import sys

def install_requirements():
    """Install required packages"""
    print("Installing required packages...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("✅ All packages installed successfully!")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to install packages: {e}")
        return False

def setup_directories():
    """Create necessary directories"""
    directories = ['scraped_data', 'logs']
    for directory in directories:
        if not os.path.exists(directory):
            os.makedirs(directory)
            print(f"Created directory: {directory}")

def test_installation():
    """Test if everything is working"""
    print("\nTesting installation...")
    try:
        from selenium import webdriver
        from webdriver_manager.chrome import ChromeDriverManager
        from selenium.webdriver.chrome.service import Service
        from selenium.webdriver.chrome.options import Options
        
        # Test ChromeDriver
        options = Options()
        options.add_argument("--headless")
        service = Service(ChromeDriverManager().install())
        
        driver = webdriver.Chrome(service=service, options=options)
        driver.get("https://www.google.com")
        driver.quit()
        
        print("✅ Installation test passed!")
        return True
    except Exception as e:
        print(f"❌ Installation test failed: {e}")
        return False

def main():
    """Main setup function"""
    print("=== CinetPay Scraper Setup ===")
    
    # Install requirements
    if not install_requirements():
        print("Setup failed during package installation.")
        return
    
    # Setup directories
    setup_directories()
    
    # Test installation
    if test_installation():
        print("\n🎉 Setup completed successfully!")
        print("\nNext steps:")
        print("1. Set your credentials:")
        print("   export CINETPAY_EMAIL='your_email@example.com'")
        print("   export CINETPAY_PASSWORD='your_password'")
        print("2. Run the scraper:")
        print("   python main_scraper.py")
        print("   or")
        print("   python main_scraper.py --quick")
    else:
        print("\n⚠️  Setup completed but tests failed. Check your Chrome installation.")

if __name__ == "__main__":
    main()