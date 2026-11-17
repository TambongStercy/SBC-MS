import { Pagination as KitPagination } from './ui';

/**
 * Legacy page navigation (postsPerPage / totalPosts / setCurrentPage), now
 * drawn by the kit Pagination. Not used by any screen today; kept for its API.
 */
const Pagination = ({ postsPerPage, totalPosts, currentPage, setCurrentPage }: {
    postsPerPage: number;
    totalPosts: number;
    currentPage: number;
    setCurrentPage: (page: number) => void;
}) => (
    <KitPagination
        page={currentPage}
        totalPages={Math.max(1, Math.ceil(totalPosts / postsPerPage))}
        total={totalPosts}
        pageSize={postsPerPage}
        onPageChange={setCurrentPage}
    />
);

export default Pagination;
