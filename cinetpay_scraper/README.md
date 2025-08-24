# CinetPay Transaction Scraper

A comprehensive Python web scraper for extracting transaction data from the CinetPay merchant dashboard using Selenium.

## Features

- 🔐 Automated login to CinetPay dashboard
- 🔍 Advanced filtering options (date range, country, status, business)
- 📄 Multi-page scraping with pagination handling
- 💾 CSV export with detailed transaction data
- 📊 Summary statistics and reporting
- 🎛️ Interactive configuration
- 🚀 Quick scrape mode for default settings
- 🔒 Headless browser support

## Installation

### Method 1: Automatic Setup

1. Clone or download all the files
2. Run the setup script:
```bash
python setup.py
```

### Method 2: Manual Setup

1. Install Python packages:
```bash
pip install -r requirements.txt
```

2. Create directories:
```bash
mkdir scraped_data
mkdir logs
```

## Configuration

### Set Your Credentials

**Option 1: Environment Variables (Recommended)**
```bash
# Windows
set CINETPAY_EMAIL=your_email@example.com
set CINETPAY_PASSWORD=your_password

# Mac/Linux
export CINETPAY_EMAIL=your_email@example.com
export CINETPAY_PASSWORD=your_password
```

**Option 2: Edit config.py**
Replace the placeholder values in `config.py`:
```python
EMAIL = 'your_actual_email@example.com'
PASSWORD = 'your_actual_password'
```

## Usage

### Interactive Mode (Recommended)
```bash
python main_scraper.py
```

This will guide you through:
- Date range selection
- Country selection
- Transaction status filtering
- Business filtering
- Page limits
- Headless mode options

### Quick Scrape Mode
```bash
python main_scraper.py --quick
```

Uses default settings:
- Last 30 days
- Cote d'Ivoire
- Successful transactions only
- All businesses
- All pages

### Test ChromeDriver
```bash
python test_chromedriver.py
```

## File Structure

```
cinetpay_scraper/
├── main_scraper.py          # Main script with interactive interface
├── cinetpay_scraper.py      # Core scraper class
├── config.py                # Configuration settings
├── test_chromedriver.py     # ChromeDriver test script
├── setup.py                 # Automatic setup script
├── requirements.txt         # Python dependencies
├── README.md               # This documentation
├── scraped_data/           # Output directory (created automatically)
└── logs/                   # Log files (created automatically)
```

## Configuration Options

### Filter Options

| Filter | Description | Values |
|--------|-------------|--------|
| Date Range | Transaction date range | Last 7/30/90 days or custom |
| Country | Country code | 225 (Cote d'Ivoire), 237 (Cameroun), etc. |
| Status | Transaction status | ACCEPTED, REFUSED, or All |
| Business | Business ID | Specific business or All |
| Max Pages | Page limit | Number or All |

### Country Codes

- 🇨🇮 Cote d'Ivoire: 225
- 🇨🇲 Cameroun: 237
- 🇲🇱 Mali: 223
- 🇸🇳 Senegal: 221
- 🇧🇫 Burkina Faso: 226
- 🇹🇬 Togo: 228
- 🇨🇩 Congo RDC: 243
- 🇬🇳 Guinée: 224
- 🇧🇯 Bénin: 229
- And more...

## Output

### CSV File Structure

The scraper exports data to CSV files with the following columns:

| Column | Description |
|--------|-------------|
| date | Transaction date and time |
| transaction_id | Unique transaction ID |
| phone_number | Customer phone number |
| amount | Transaction amount |
| status | Transaction status |
| payment_method | Payment method used |
| currency | Transaction currency |
| error_message | Error details (if any) |
| business_id | Business identifier |
| business_name | Business name |
| operator_id | Operator transaction ID |
| phone_prefix | Phone number prefix |
| designation | Transaction description |
| And more... | Additional fields |

### File Naming

Files are saved as: `cinetpay_transactions_YYYYMMDD_HHMMSS.csv`

Example: `cinetpay_transactions_20250821_143022.csv`

## Troubleshooting

### Common Issues

1. **ChromeDriver Issues**
   ```bash
   python test_chromedriver.py
   ```

2. **Login Failed**
   - Check credentials
   - Verify internet connection
   - Check if CinetPay website is accessible

3. **No Transactions Found**
   - Adjust date range
   - Change filter settings
   - Verify account has transactions

4. **Page Load Timeout**
   - Check internet connection
   - Increase timeout in config.py
   - Try headless mode

### Error Messages

| Error | Solution |
|-------|----------|
| `Login timeout` | Check credentials and internet |
| `Element not found` | Website may have changed, update selectors |
| `ChromeDriver not found` | Run `python test_chromedriver.py` |
| `No transactions found` | Adjust filters or date range |

## Advanced Usage

### Custom Configuration

Edit `config.py` to customize:
- Default filters
- Timeout settings
- Chrome options
- Output formats

### Programmatic Usage

```python
from cinetpay_scraper import CinetPayScraper
from config import Config

# Initialize scraper
scraper = CinetPayScraper(headless=True)

try:
    # Login and scrape
    scraper.login()
    scraper.navigate_to_transactions()
    scraper.set_filters(
        country_code="225",
        status="ACCEPTED",
        date_range=("2025-01-01", "2025-08-21")
    )
    
    transactions = scraper.scrape_all_pages(max_pages=5)
    filename = scraper.save_to_csv(transactions)
    
    print(f"Scraped {len(transactions)} transactions to {filename}")
    
finally:
    scraper.close()
```

## Performance Tips

1. **Use Headless Mode** for faster scraping
2. **Limit Pages** for testing (`max_pages=5`)
3. **Adjust Delays** in config.py if needed
4. **Filter Early** to reduce data volume

## Security Notes

- Never commit credentials to version control
- Use environment variables for credentials
- Run in secure environments only
- Respect website terms of service

## Support

For issues or questions:
1. Check the troubleshooting section
2. Run test scripts to verify setup
3. Check logs for detailed error messages

## License

This project is for educational and personal use only. Respect CinetPay's terms of service and rate limits.