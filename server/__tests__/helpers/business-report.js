module.exports = {
  orders: [
    { id:1,user_id:1,status:'completed',total_amount:880,DiscountAmount:200,created_at:'2026-09-30T17:00:00.000Z' },
    { id:2,user_id:1,status:'completed',total_amount:220,DiscountAmount:0,created_at:'2026-10-07T16:59:59.999Z' },
    { id:3,user_id:2,status:'completed',total_amount:650,DiscountAmount:50,created_at:'2026-10-03T03:00:00.000Z' },
    { id:4,user_id:99,status:'cancelled',total_amount:99999,DiscountAmount:0,created_at:'2026-10-04T00:00:00.000Z' },
    { id:5,user_id:3,status:'paid',total_amount:77777,DiscountAmount:0,created_at:'2026-10-05T00:00:00.000Z' },
    { id:6,user_id:4,status:'shipped',total_amount:66666,DiscountAmount:0,created_at:'2026-10-06T00:00:00.000Z' },
    { id:7,user_id:5,status:'completed',total_amount:55555,DiscountAmount:0,created_at:'2026-09-30T16:59:59.999Z' },
    { id:8,user_id:6,status:'completed',total_amount:44444,DiscountAmount:0,created_at:'2026-10-07T17:00:00.000Z' },
    { id:9,user_id:1,status:'pending',total_amount:300,DiscountAmount:0,created_at:'2026-10-01T10:00:00.000Z' }
  ],
  items: [
    {id:1,order_id:1,product_id:11,product_name:'Áo cũ',quantity:2,line_total:1000},
    {id:2,order_id:2,product_id:12,product_name:'Áo Nike, phiên bản "Sport"\nMàu đỏ',quantity:1,line_total:200},
    {id:3,order_id:3,product_id:11,product_name:'Áo mới',quantity:1,line_total:300},
    {id:4,order_id:3,product_id:12,product_name:'Quần cũ',quantity:2,line_total:400},
    ...[4,5,6,7,8].map(id=>({id:id+1,order_id:id,product_id:13,product_name:'Không được tính',quantity:500,line_total:99999}))
  ],
  products: [{id:11,name_vi:'Tên đã đổi',images:'[]'},{id:12,name_vi:'Giá và tên hiện tại khác snapshot',images:'["img/test.png"]'}],
  summary: {revenue:1750,orders:7,completedOrders:3,cancelledOrders:1,customers:2,productsSold:6,aov:583},
  top: [{id:11,name:'Áo mới',imageUrl:'img/breeze.png',unitsSold:3,revenue:1079},
    {id:12,name:'Áo Nike, phiên bản "Sport"\nMàu đỏ',imageUrl:'img/test.png',unitsSold:3,revenue:571}]
};
