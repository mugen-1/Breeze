'use strict';
const express = require('express'), multer = require('multer');
const router = express.Router({mergeParams:true});
const { verifyFirebaseToken } = require('../middleware/auth');
const { buildUserActionLimiter } = require('../middleware/security');
const { getPool } = require('../db');
const { MAX_IMAGE_BYTES } = require('../lib/image-upload');
const { ReviewError, prepareImages, storage } = require('../lib/review-media');
const { parseId, validateReview, createReview } = require('../lib/review-create');
const {parseReviewQuery,getPublicReviews}=require('../lib/review-list');
const {getOwnerReview,validateUpdate,changeOwnerReview}=require('../lib/review-owner');
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_IMAGE_BYTES,files:5,fields:3,fieldSize:8192,parts:9}}).array('images',5);
const editUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_IMAGE_BYTES,files:5,fields:4,fieldSize:8192,parts:10}}).array('images',5);
const limiter = buildUserActionLimiter({windowMs:15*60*1000,limit:10});
function errorResponse(res,error) {
  if (error instanceof ReviewError) return res.status(error.status).json({status:'error',code:error.code,message:error.message});
  console.error('[reviews] request failed:',error.code || 'server-error');
  return res.status(500).json({status:'error',code:'REVIEW_SERVER_ERROR',message:'Không gửi được đánh giá. Vui lòng thử lại'});
}
router.get('/me',verifyFirebaseToken,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
    const id=parseId(req.params.id);
    if(id===null)throw new ReviewError(400,'REVIEW_INVALID_PRODUCT','Mã sản phẩm không hợp lệ');
    res.json(await getOwnerReview(await getPool(),req.user.id,id));
  }catch(error){errorResponse(res,error);}
});
function ownerIds(req,res,next){
  req.reviewProductId=parseId(req.params.id);req.reviewId=parseId(req.params.reviewId,1);
  if(req.reviewProductId===null||req.reviewId===null)return errorResponse(res,new ReviewError(400,'REVIEW_INVALID_INPUT','Mã đánh giá không hợp lệ'));
  next();
}
function uploadBody(parser){return (req,res,next)=>parser(req,res,error=>{
  if(!error)return next();
  const size=error.code==='LIMIT_FILE_SIZE',count=['LIMIT_FILE_COUNT','LIMIT_UNEXPECTED_FILE','LIMIT_PART_COUNT'].includes(error.code);
  errorResponse(res,new ReviewError(size?413:400,size?'REVIEW_IMAGE_TOO_LARGE':count?'REVIEW_TOO_MANY_IMAGES':'REVIEW_INVALID_INPUT',
    size?'Mỗi ảnh tối đa 2MB':count?'Chỉ nhận tối đa 5 ảnh ở field images':'Dữ liệu tải lên không hợp lệ'));
});}
router.patch('/:reviewId',verifyFirebaseToken,ownerIds,limiter,uploadBody(editUpload),async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
    const data=validateUpdate(req.body),images=await prepareImages(req.files||[]);
    res.json(await changeOwnerReview(await getPool(),{userId:req.user.id,productId:req.reviewProductId,reviewId:req.reviewId,data,images,storage}));
  }catch(error){errorResponse(res,error);}
});
router.delete('/:reviewId',verifyFirebaseToken,ownerIds,limiter,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
    await changeOwnerReview(await getPool(),{userId:req.user.id,productId:req.reviewProductId,reviewId:req.reviewId,storage,removeReview:true});
    res.json({status:'success'});
  }catch(error){errorResponse(res,error);}
});
// Public reads never authenticate/upsert users or infer ownership from client input.
router.get('/',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try {
    const id=parseId(req.params.id);
    if(id===null)throw new ReviewError(400,'REVIEW_INVALID_PRODUCT','Mã sản phẩm không hợp lệ');
    const options=parseReviewQuery(req.query);
    res.json(await getPublicReviews(await getPool(),id,options));
  } catch(error) {
    if(error instanceof ReviewError)return res.status(error.status).json({status:'error',code:error.code,message:error.message});
    console.error('[reviews] list failed:',error.code||'server-error');
    res.status(500).json({status:'error',code:'REVIEW_LIST_ERROR',message:'Không thể tải đánh giá'});
  }
});
router.post('/',verifyFirebaseToken,(req,res,next)=>{
  req.reviewProductId = parseId(req.params.id);
  if (req.reviewProductId === null) return res.status(400).json({status:'error',code:'REVIEW_INVALID_PRODUCT',message:'Mã sản phẩm không hợp lệ'});
  next();
},limiter,(req,res,next)=>{
  upload(req,res,error=>{
    if (!error) return next();
    const size = error.code === 'LIMIT_FILE_SIZE';
    const count = ['LIMIT_FILE_COUNT','LIMIT_UNEXPECTED_FILE','LIMIT_PART_COUNT'].includes(error.code);
    errorResponse(res,new ReviewError(size?413:400,size?'REVIEW_IMAGE_TOO_LARGE':count?'REVIEW_TOO_MANY_IMAGES':'REVIEW_INVALID_INPUT',
      size?'Mỗi ảnh tối đa 2MB':count?'Chỉ nhận tối đa 5 ảnh ở field images':'Dữ liệu tải lên không hợp lệ'));
  });
},async(req,res)=>{
  res.set('Cache-Control','no-store');
  try {
    const data = validateReview(req.body);
    const images = await prepareImages(req.files || []);
    const review = await createReview(await getPool(),{userId:req.user.id,productId:req.reviewProductId,data,images,storage});
    res.status(201).json(review);
  } catch (error) { errorResponse(res,error); }
});
module.exports = router;
