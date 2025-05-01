const btnClass =
    "bg-transparent hover:bg-blue-500 text-blue-700 font-semibold hover:text-white py-2 px-4 border border-blue-500 hover:border-transparent rounded m-2";
const btnClassBlue =
    "bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded m-2";


const Pagination = ({ postsPerPage, totalPosts, currentPage, setCurrentPage }: any) => {
    const pageNumbers = [];
    const totalPages = Math.ceil(totalPosts / postsPerPage);

    // Generate page numbers dynamically based on the current page
    if (totalPages <= 7) {
        // If total pages are 7 or less, show all pages
        for (let i = 1; i <= totalPages; i++) {
            pageNumbers.push(i);
        }
    } else {
        // Show first 2 pages and last 2 pages, and add ellipsis if needed
        pageNumbers.push(1);
        if (currentPage > 3) {
            pageNumbers.push('...');
        }

        // Pages around the current page
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
            pageNumbers.push(i);
        }

        if (currentPage < totalPages - 2) {
            pageNumbers.push('...');
        }
        pageNumbers.push(totalPages);
    }

    const handlePageChange = (pageNumber: any) => {
        if (pageNumber === '...') return; // Do nothing when clicking ellipsis
        setCurrentPage(pageNumber);
    };

    return (
        <div className="pagination flex justify-center items-center space-x-2 mt-4">
            
            <button
                className={`page-item ${btnClassBlue} ${currentPage === 1? "hidden" : ""}`}
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
            >
                {"<"}
            </button>

            {pageNumbers.map((number, index) => (
                <button
                    key={index}
                    onClick={() => handlePageChange(number)}
                    className={`page-item ${currentPage === number ? btnClass : btnClassBlue} `}
                >
                    {number}
                </button>
            ))}

            <button
                className={`page-item ${btnClassBlue} ${currentPage === totalPages? "hidden" : ""}`}
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
            >
                {">"}
            </button>
        </div>
    );
};

export default Pagination;
